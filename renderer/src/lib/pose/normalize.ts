import type { PoseFrame } from "./types";
import { L } from "./types";
import { mid, norm, sub, type Vec3 } from "./vec";
import { VIS_THRESHOLD } from "./prepare";

/**
 * Normalize a pose so it is invariant to translation and scale:
 * - origin at hip midpoint (per frame — the origin must track the athlete)
 * - rescaled so shoulder-to-hip midpoint distance = 1
 *
 * This does NOT rotate the pose. Handedness (left vs right) and facing direction
 * are preserved so angle comparisons remain meaningful.
 *
 * MediaPipe world coordinates are y-DOWN (the head sits at smaller/negative y
 * than the hips); nothing here depends on that, but see detectUpSign in
 * angles.ts for the features that do.
 *
 * `scaleOverride` supplies a fixed scale factor. For video clips the caller
 * (normalizeAll) passes the clip-median torso scale: torso length is
 * physically constant within a clip, so its frame-to-frame variation is 100%
 * detector noise, and dividing each frame by its own instantaneous torso
 * length would multiplicatively inject that noise into all 33 landmarks'
 * trajectories every frame. A single robust per-clip scale removes the noise
 * while staying invariant to camera distance.
 */
export function normalizeFrame(frame: PoseFrame, scaleOverride?: number): PoseFrame {
  const ls = frame[L.LEFT_SHOULDER];
  const rs = frame[L.RIGHT_SHOULDER];
  const lh = frame[L.LEFT_HIP];
  const rh = frame[L.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return frame;

  const hipMid: Vec3 = mid(lh, rh);
  const s = scaleOverride ?? frameScale(frame) ?? 1;

  return frame.map((lm) => ({
    x: (lm.x - hipMid.x) * s,
    y: (lm.y - hipMid.y) * s,
    z: (lm.z - hipMid.z) * s,
    visibility: lm.visibility,
  }));
}

/** This frame's instantaneous 1/torso-length scale, or null when degenerate. */
function frameScale(frame: PoseFrame): number | null {
  const ls = frame[L.LEFT_SHOULDER];
  const rs = frame[L.RIGHT_SHOULDER];
  const lh = frame[L.LEFT_HIP];
  const rh = frame[L.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return null;
  const torso = norm(sub(mid(ls, rs), mid(lh, rh)));
  return torso > 1e-6 ? 1 / torso : null;
}

/**
 * Median torso length over the frames whose four torso anchor landmarks are all
 * confidently visible — so a hallucinated low-visibility hip can't skew the
 * clip's scale. Falls back to all non-degenerate frames when no frame clears
 * the visibility bar (e.g. visibility data absent entirely).
 */
function clipScale(frames: PoseFrame[]): number | null {
  const confident: number[] = [];
  const any: number[] = [];
  for (const f of frames) {
    const ls = f[L.LEFT_SHOULDER];
    const rs = f[L.RIGHT_SHOULDER];
    const lh = f[L.LEFT_HIP];
    const rh = f[L.RIGHT_HIP];
    if (!ls || !rs || !lh || !rh) continue;
    const torso = norm(sub(mid(ls, rs), mid(lh, rh)));
    if (!(torso > 1e-6)) continue;
    any.push(torso);
    const visOk =
      ls.visibility >= VIS_THRESHOLD &&
      rs.visibility >= VIS_THRESHOLD &&
      lh.visibility >= VIS_THRESHOLD &&
      rh.visibility >= VIS_THRESHOLD;
    if (visOk) confident.push(torso);
  }
  const pool = confident.length > 0 ? confident : any;
  if (pool.length === 0) return null;
  pool.sort((a, b) => a - b);
  const n = pool.length;
  const med = n % 2 ? pool[(n - 1) / 2] : (pool[n / 2 - 1] + pool[n / 2]) / 2;
  return 1 / med;
}

export function normalizeAll(frames: PoseFrame[]): PoseFrame[] {
  // One robust scale per clip (see normalizeFrame doc). Single-frame input
  // degenerates to that frame's own torso length, preserving the old behavior
  // for still images.
  const s = clipScale(frames) ?? undefined;
  return frames.map((f) => normalizeFrame(f, s));
}
