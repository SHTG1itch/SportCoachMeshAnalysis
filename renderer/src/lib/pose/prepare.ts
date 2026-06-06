import type { PoseFrame, Landmark3D } from "./types";

/**
 * Visibility below which a landmark sample is treated as missing and replaced
 * by temporal interpolation. MediaPipe reports visibility in 0..1; values this
 * low are typically occlusions or outright detection failures.
 */
export const VIS_THRESHOLD = 0.3;

/**
 * Replace missing / low-confidence landmark samples by interpolating each
 * landmark independently across time.
 *
 * Why this exists: when MediaPipe fails to detect a pose on a frame, the
 * extractor pushes an all-zero `emptyFrame()`. Left untouched, a zero pose
 * produces nonsense joint angles (every limb reads as fully extended, 180°)
 * that then pollute the DTW path, the per-joint deltas, and the similarity
 * score. Even within a detected frame, individual occluded landmarks carry
 * low visibility and noisy positions.
 *
 * Strategy (per landmark index, across the whole clip):
 *   - Treat samples with visibility >= `threshold` as anchors.
 *   - For a gap between two anchors, linearly interpolate x/y/z (and the
 *     visibility, which stays >= threshold so the value is usable downstream).
 *   - For a gap before the first / after the last anchor, hold the nearest
 *     anchor (no extrapolation — that would fabricate motion).
 *   - If a landmark is never visible in the entire clip, leave it as-is.
 *
 * The frame count is preserved, so fps, phase indices, and DTW paths are
 * unaffected. This is a contained, deterministic cleanup with no free
 * parameters beyond the single visibility threshold.
 */
export function fillGaps(
  frames: PoseFrame[],
  threshold: number = VIS_THRESHOLD,
): PoseFrame[] {
  const n = frames.length;
  if (n === 0) return frames;
  const numLm = frames[0].length;

  // Deep-copy so we never mutate the caller's frames.
  const out: PoseFrame[] = frames.map((f) =>
    f.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility })),
  );

  for (let j = 0; j < numLm; j++) {
    // Indices of frames where this landmark is a trustworthy anchor.
    const anchors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (frames[i][j] && frames[i][j].visibility >= threshold) anchors.push(i);
    }
    if (anchors.length === 0) continue; // never seen — nothing to interpolate from

    // Hold the first anchor backwards over any leading gap.
    const first = anchors[0];
    for (let i = 0; i < first; i++) out[i][j] = copyLm(frames[first][j]);

    // Hold the last anchor forwards over any trailing gap.
    const last = anchors[anchors.length - 1];
    for (let i = last + 1; i < n; i++) out[i][j] = copyLm(frames[last][j]);

    // Linearly interpolate interior gaps between consecutive anchors.
    for (let a = 0; a < anchors.length - 1; a++) {
      const lo = anchors[a];
      const hi = anchors[a + 1];
      if (hi - lo <= 1) continue; // adjacent anchors, no gap
      const A = frames[lo][j];
      const B = frames[hi][j];
      for (let i = lo + 1; i < hi; i++) {
        const t = (i - lo) / (hi - lo);
        out[i][j] = {
          x: A.x + (B.x - A.x) * t,
          y: A.y + (B.y - A.y) * t,
          z: A.z + (B.z - A.z) * t,
          visibility: A.visibility + (B.visibility - A.visibility) * t,
        };
      }
    }
  }

  return out;
}

function copyLm(lm: Landmark3D): Landmark3D {
  return { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility };
}

/**
 * Binomial coefficients for a window of half-width `radius` (size 2r+1),
 * normalized to sum to 1. Binomial weights approximate a Gaussian low-pass:
 * they attenuate frame-to-frame jitter while preserving the location of a
 * genuine velocity peak far better than a flat box filter — which matters
 * because `detectPhases` keys on that peak.
 */
function binomialWeights(radius: number): number[] {
  const size = 2 * radius + 1;
  const w = new Array<number>(size);
  // Pascal's triangle row `size - 1`.
  w[0] = 1;
  for (let k = 1; k < size; k++) {
    w[k] = (w[k - 1] * (size - k)) / k;
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * Smooth landmark trajectories over time with a small centred binomial filter.
 *
 * Applied per landmark, per coordinate, after gap-filling and before
 * normalization, this removes the high-frequency tremor characteristic of
 * single-frame pose estimation so that joint angles (and their frame-to-frame
 * deltas) reflect real movement rather than detector noise.
 *
 * `radius` defaults to 1 (a 3-tap [1 2 1]/4 filter) deliberately: wide windows
 * blur the speed peak that phase detection relies on. Visibility is carried
 * through unchanged. Edge frames use a shrunk, renormalized window so the ends
 * are not pulled toward the interior.
 */
export function smoothFrames(
  frames: PoseFrame[],
  radius: number = 1,
): PoseFrame[] {
  const n = frames.length;
  if (n === 0 || radius < 1) return frames.map((f) => f.map(copyLm));
  const numLm = frames[0].length;
  const weights = binomialWeights(radius);

  const out: PoseFrame[] = frames.map((f) => f.map(copyLm));
  for (let j = 0; j < numLm; j++) {
    for (let i = 0; i < n; i++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let wsum = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = i + k;
        if (idx < 0 || idx >= n) continue;
        const wt = weights[k + radius];
        const lm = frames[idx][j];
        sx += lm.x * wt;
        sy += lm.y * wt;
        sz += lm.z * wt;
        wsum += wt;
      }
      out[i][j].x = sx / wsum;
      out[i][j].y = sy / wsum;
      out[i][j].z = sz / wsum;
    }
  }
  return out;
}

/**
 * Fraction of frames in which the core torso landmarks (both shoulders + both
 * hips) were actually detected. A clip where the body was rarely found yields a
 * low score, which callers can surface as a confidence caveat.
 */
export function detectionCoverage(
  frames: PoseFrame[],
  coreIndices: number[],
  threshold: number = VIS_THRESHOLD,
): number {
  if (frames.length === 0) return 0;
  let detected = 0;
  for (const f of frames) {
    if (coreIndices.every((i) => f[i] && f[i].visibility >= threshold)) detected++;
  }
  return detected / frames.length;
}
