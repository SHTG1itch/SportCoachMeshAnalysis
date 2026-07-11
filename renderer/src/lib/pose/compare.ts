import type {
  AnalysisReport,
  Handedness,
  JointDelta,
  JointName,
  MeshComparison,
  MeshPose,
  PhaseSummary,
  SportMeta,
} from "@shared/types";
import type { Landmark3D, PoseFrame } from "./types";
import {
  JOINT_FEATURES,
  computeAnglesSequence,
  featureConfidenceSequence,
} from "./angles";
import { normalizeAll } from "./normalize";
import { fillGaps, despikeFrames, smoothFrames, detectionCoverage, VIS_THRESHOLD } from "./prepare";
import { L } from "./types";
import {
  detectDominantSide,
  jointType,
  mirrorAnglesSequence,
  sidedJoint,
  type Side,
} from "./handedness";
import { activeWindow, detectPhases, type Phase } from "./phases";
import { dtw, similarityTimeline } from "./dtw";

export interface CompareInput {
  sport: SportMeta;
  shot: string;
  pro: {
    frames: PoseFrame[];
    fps: number;
    kind: "image" | "video";
  };
  user: {
    frames: PoseFrame[];
    fps: number;
  };
}

/**
 * Significance thresholds (degrees of *systematic* difference, i.e. |signedBias|).
 *
 * We key significance on the signed bias — the average direction-aware offset
 * between user and pro — NOT the mean absolute per-frame delta. The mean abs
 * delta is inflated by timing differences and detection noise (two clips of the
 * SAME athlete can show a 20°+ mean abs delta while their average poses are
 * within a couple of degrees). The signed bias cancels that noise and isolates
 * the consistent, coachable technique difference. A ~7° systematic offset in a
 * major joint is what a coach would call out; ~15°+ is a clear fault.
 */
function significance(systematicDeg: number): "low" | "medium" | "high" {
  if (systematicDeg >= 15) return "high";
  if (systematicDeg >= 7) return "medium";
  return "low";
}

/**
 * Symmetric trimmed mean — drops the lowest and highest `trim` fraction of
 * samples before averaging. This keeps a few badly-detected or mis-aligned
 * frames (which produce extreme single-frame joint-angle errors) from inflating
 * the reported per-joint differences. Falls back to the plain mean when there
 * are too few samples to trim meaningfully.
 */
function trimmedMean(xs: number[], trim = 0.1): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n < 6) return xs.reduce((a, b) => a + b, 0) / n;
  const s = [...xs].sort((a, b) => a - b);
  // Trim at least one sample from each end once there are enough, so even short
  // phase windows shed their single worst (motion-blur) frame.
  const k = Math.max(1, Math.floor(n * trim));
  let sum = 0;
  let c = 0;
  for (let i = k; i < n - k; i++) {
    sum += s[i];
    c++;
  }
  if (c) return sum / c;
  // Degenerate (everything trimmed) — fall back to a true median, averaging the
  // two central samples for even n rather than picking the upper-middle one.
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Value at percentile `p` (0..1) of `xs` (nearest-rank). */
function percentile(xs: number[], p: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)));
  return s[idx];
}

/**
 * Confidence-weighted trimmed mean. Samples are sorted by value and the lowest
 * and highest `trim` fraction of TOTAL WEIGHT (not sample count) is discarded —
 * fractionally at the boundaries — before taking the weighted mean of what
 * remains. With uniform weights this reduces to the plain trimmed mean; with
 * confidence weights, a low-visibility (motion-blurred / occluded) frame's
 * detector guess contributes proportionally less to the reported statistic.
 * Falls back to the unweighted path when the weights carry no signal (all 0).
 */
export function weightedTrimmedMean(
  xs: number[],
  ws: number[],
  trim = 0.1,
): number {
  const n = xs.length;
  if (n === 0) return 0;
  let W = 0;
  for (let i = 0; i < n; i++) W += ws[i];
  if (!(W > 0)) return trimmedMean(xs, trim);
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  if (n < 6) {
    // Too few samples to trim meaningfully — plain weighted mean (mirrors the
    // unweighted trimmedMean's small-n fallback).
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[i] * ws[i];
    return s / W;
  }
  const lo = W * trim;
  const hi = W * (1 - trim);
  let cum = 0;
  let sum = 0;
  let effW = 0;
  for (const i of order) {
    const start = cum;
    cum += ws[i];
    // Effective weight = the part of this sample's weight interval that falls
    // inside the kept band [lo, hi].
    const eff = Math.min(cum, hi) - Math.max(start, lo);
    if (eff > 0) {
      sum += xs[i] * eff;
      effW += eff;
    }
  }
  return effW > 0 ? sum / effW : trimmedMean(xs, trim);
}

/**
 * Confidence-weighted percentile: smallest value whose cumulative weight
 * reaches `p` of the total. Uniform weights reproduce the nearest-rank
 * percentile to within one sample; zero total weight falls back to unweighted.
 */
export function weightedPercentile(
  xs: number[],
  ws: number[],
  p: number,
): number {
  const n = xs.length;
  if (n === 0) return 0;
  let W = 0;
  for (let i = 0; i < n; i++) W += ws[i];
  if (!(W > 0)) return percentile(xs, p);
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const target = W * p;
  let cum = 0;
  for (const i of order) {
    cum += ws[i];
    if (cum >= target) return xs[i];
  }
  return xs[order[n - 1]];
}

/**
 * Per-feature scale (degrees) = one unit of "meaningful technique difference"
 * for that joint. Used to standardize the angle vector before DTW alignment and
 * similarity scoring. Without it, wide-range joints (elbow/shoulder, ~0–180°)
 * dominate the Euclidean distance, so a small relative error there outweighs a
 * large relative error in a tighter feature (e.g. trunk lean). These are fixed
 * biomechanical magnitudes — NOT fitted to any test clip — so the score is
 * stable and comparable across different footage. Order matches JOINT_FEATURES.
 */
const FEATURE_SCALE_DEG: number[] = [
  25, 25, // L/R elbow flexion
  25, 25, // L/R shoulder abduction
  20, 20, // L/R hip flexion
  20, 20, // L/R knee flexion
  18, 18, // L/R ankle dorsiflexion
  20, // trunk_rotation
  12, // trunk_lean
  12, // shoulder_line_tilt
];
/** Cap each feature's standardized contribution so one blown-out frame (motion
 * blur, a detection glitch) can't dominate the alignment or the score. */
const Z_CLAMP = 4;
/** A clip differing by SIM_NORM scale-units per feature on average scores 0;
 * ~1 unit average ≈ a clearly different but still recognizable motion. */
const SIM_NORM = 3.0;

/** RMS clamped z-distance between two angle-feature vectors (0 = identical). */
function standardizedDistance(a: number[], b: number[]): number {
  const F = FEATURE_SCALE_DEG.length;
  let s = 0;
  for (let f = 0; f < F; f++) {
    let z = (a[f] - b[f]) / FEATURE_SCALE_DEG[f];
    if (z > Z_CLAMP) z = Z_CLAMP;
    else if (z < -Z_CLAMP) z = -Z_CLAMP;
    s += z * z;
  }
  return Math.sqrt(s / F);
}

/**
 * Confidence-weighted variant. Each vector is an angle vector with its
 * per-feature detection confidence appended (see augmentWithConf); a feature
 * counts with weight = min(confidence on either side). Without this, the DTW
 * path, similarity timeline, and headline score trusted every feature at full
 * strength — a user filmed waist-up (MediaPipe still emits confident-LOOKING
 * positions for the unseen legs, with low visibility) had four garbage leg
 * features dragging the score down and distorting the alignment on every
 * frame, while the per-joint deltas correctly discounted them. The headline
 * number penalized framing, not technique.
 *
 * Falls back to the unweighted distance when the weights carry no signal (all
 * ~0), so two all-occluded frames still compare rather than reading as
 * identical.
 */
function weightedStandardizedDistance(a: number[], b: number[]): number {
  const F = FEATURE_SCALE_DEG.length;
  let s = 0;
  let W = 0;
  for (let f = 0; f < F; f++) {
    const w = Math.min(a[F + f], b[F + f]);
    if (!(w > 0)) continue;
    let z = (a[f] - b[f]) / FEATURE_SCALE_DEG[f];
    if (z > Z_CLAMP) z = Z_CLAMP;
    else if (z < -Z_CLAMP) z = -Z_CLAMP;
    s += w * z * z;
    W += w;
  }
  if (!(W > 1e-9)) return standardizedDistance(a, b);
  return Math.sqrt(s / W);
}

/** Concatenate each frame's angle vector with its per-feature confidence so a
 * plain (a, b) distance function can weight features without index context. */
function augmentWithConf(angles: number[][], conf: number[][]): number[][] {
  return angles.map((row, i) => row.concat(conf[i] ?? row.map(() => 1)));
}

function similarityFromDistance(d: number): number {
  return Math.max(0, 1 - Math.min(1, d / SIM_NORM));
}

const TRUNK_LEAN_IDX = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
/** A standing athlete's torso never leans past horizontal; a trunk_lean beyond
 * this (degrees) means MediaPipe flipped the pose's depth on that frame —
 * a high-confidence-but-wrong failure common on fast, motion-blurred contact
 * frames that landmark visibility does not catch. */
const TRUNK_LEAN_FLIP_DEG = 100;

/**
 * Repair frames where the torso reads as implausibly inverted (a MediaPipe
 * depth-flip) by linearly interpolating the WHOLE angle vector across the bad
 * run from the nearest physically-valid frames. The flip corrupts every
 * depth-dependent feature on that frame (trunk lean/rotation, and any
 * left/right swap), so the whole vector is repaired — mirroring how fillGaps
 * repairs missing landmarks. Frames at the clip ends are held from the nearest
 * valid frame (no extrapolation). A no-op for clean clips.
 *
 * `conf` (optional, per-frame per-feature confidence) tightens the anchor
 * test: a frame whose trunk landmarks were below the visibility gate has its
 * trunk_lean hard-zeroed by computeAngles — trivially "plausible" — and would
 * otherwise anchor the interpolation with gated zeros. Anchors must be both
 * physically plausible AND confidently seen (falling back to plausible-only
 * when nothing clears the bar, so the repair never regresses to giving up).
 */
export function repairImplausibleFrames(
  seq: number[][],
  conf?: number[][],
): number[][] {
  return repairImplausible(seq, conf).seq;
}

/**
 * As repairImplausibleFrames, but also reports WHICH frames were synthesized
 * (interpolated or edge-held), so the caller can cap their detection
 * confidence: the flip frames escaped visibility gating precisely because the
 * detector was confident, and without the cap DTW/deltas would weight the
 * fabricated replacement values at full strength — the opposite of the
 * pipeline's rule that synthetic samples carry honest low confidence.
 */
export function repairImplausible(
  seq: number[][],
  conf?: number[][],
): { seq: number[][]; repaired: boolean[] } {
  const repaired = new Array<boolean>(seq.length).fill(false);
  return { seq: repairImpl(seq, conf, repaired), repaired };
}

function repairImpl(
  seq: number[][],
  conf: number[][] | undefined,
  repairedOut: boolean[],
): number[][] {
  const n = seq.length;
  if (n === 0 || TRUNK_LEAN_IDX < 0) return seq;
  const F = seq[0].length;
  const out = seq.map((r) => r.slice());
  // trunk_lean is signed (forward +, backward -): a depth-flip reads as ±~180,
  // so plausibility must test the magnitude.
  const plausible = (i: number): boolean =>
    Math.abs(seq[i][TRUNK_LEAN_IDX]) <= TRUNK_LEAN_FLIP_DEG;
  let anchors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (plausible(i) && (!conf || (conf[i]?.[TRUNK_LEAN_IDX] ?? 0) >= VIS_THRESHOLD)) {
      anchors.push(i);
    }
  }
  if (conf && anchors.length === 0) {
    // Nothing both plausible and confident — fall back to plausibility alone.
    for (let i = 0; i < n; i++) if (plausible(i)) anchors.push(i);
  }
  if (anchors.length === 0 || anchors.length === n) return out; // all bad (give up) or all good
  // Only IMPLAUSIBLE frames are repaired. A plausible-but-low-confidence frame
  // between two anchors keeps its measured values (its limb features may be
  // perfectly good); it just can't serve as an interpolation source.
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  // For each frame, the nearest anchor at or before / at or after it.
  const prevAnchor = new Array<number>(n).fill(-1);
  const nextAnchor = new Array<number>(n).fill(-1);
  {
    const anchorSet = new Set(anchors);
    let a = -1;
    for (let i = 0; i < n; i++) {
      if (anchorSet.has(i)) a = i;
      prevAnchor[i] = a;
    }
    let b = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (anchorSet.has(i)) b = i;
      nextAnchor[i] = b;
    }
  }
  for (let i = 0; i < n; i++) {
    if (plausible(i)) continue;
    repairedOut[i] = true;
    const lo = prevAnchor[i];
    const hi = nextAnchor[i];
    for (let f = 0; f < F; f++) {
      if (lo === -1) out[i][f] = seq[first][f]; // before the first anchor: hold it
      else if (hi === -1) out[i][f] = seq[last][f]; // after the last anchor: hold it
      else {
        const t = (i - lo) / (hi - lo);
        out[i][f] = seq[lo][f] + (seq[hi][f] - seq[lo][f]) * t;
      }
    }
  }
  return out;
}

function sortedByImpact(deltas: JointDelta[]): JointDelta[] {
  // Rank by the systematic (signed-bias) difference, not the noise-inflated mean
  // abs delta, so the most coachable differences surface first.
  const weight = (d: JointDelta): number =>
    (d.significance === "high" ? 100 : d.significance === "medium" ? 10 : 1) *
    Math.abs(d.signedBiasDeg);
  return [...deltas].sort((a, b) => weight(b) - weight(a));
}

/**
 * Build a JointDelta row from paired-sample angle arrays for that joint.
 *
 * `weights` (optional, same length as the angle arrays) carries the per-pair
 * detection confidence for this joint — min of the pro and user frame's
 * feature confidence (see featureConfidence). Every statistic, including the
 * signed bias that drives significance, is confidence-weighted: a stretch of
 * frames where the wrist is motion-blurred or hidden behind the body produces
 * detector guesses that previously voted with full strength and could fabricate
 * (or mask) a systematic offset. With no weights all samples count equally.
 */
function buildDelta(
  featureIdx: number,
  proAngles: number[],
  userAngles: number[],
  weights?: number[],
): JointDelta {
  const feat = JOINT_FEATURES[featureIdx];
  const n = Math.min(proAngles.length, userAngles.length);
  if (n === 0) {
    return {
      joint: feat.name,
      label: feat.label,
      meanDeltaDeg: 0,
      maxDeltaDeg: 0,
      proMeanDeg: 0,
      userMeanDeg: 0,
      signedBiasDeg: 0,
      significance: "low",
    };
  }
  const diffsAbs: number[] = [];
  const signed: number[] = [];
  const pros: number[] = [];
  const users: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = proAngles[i];
    const u = userAngles[i];
    // Defense in depth: the angle math (vec.angleBetweenDeg) clamps and never
    // returns NaN today, but a single non-finite sample would otherwise poison
    // the sort/sum of every robust statistic below. Drop such a sample by giving
    // it zero weight and a neutral value so it cannot move (or NaN) the result.
    const ok = Number.isFinite(p) && Number.isFinite(u);
    const d = ok ? u - p : 0;
    diffsAbs.push(Math.abs(d));
    signed.push(d);
    pros.push(ok ? p : 0);
    users.push(ok ? u : 0);
    ws.push(ok ? (weights ? weights[i] : 1) : 0);
  }
  // Robust statistics so a handful of bad frames (detection errors, DTW
  // mis-pairings) can't dominate. meanDeltaDeg is a trimmed mean of the absolute
  // gap; maxDeltaDeg is the 90th percentile ("worst typical" rather than a
  // single-frame spike). Means/bias use trimmed means too. All stay in degrees.
  const meanAbs = weightedTrimmedMean(diffsAbs, ws, 0.1);
  const signedBias = weightedTrimmedMean(signed, ws, 0.1);
  // Average detection confidence backing this joint across the paired samples.
  // When the joint was barely visible in either clip (occluded / out of frame),
  // its angle is a detector guess — and the confidence WEIGHTING above cannot
  // rescue it when there are too few samples to trim (e.g. single-frame "pro as
  // image" mode: the weighted mean of one low-visibility sample is just that
  // sample). Validated on real footage: a pro image with an occluded arm
  // (visibility ~0.05) otherwise produced a confident "elbow too bent" fault.
  // Gate significance on the backing confidence so we never coach a joint we
  // could not actually see.
  let sumW = 0;
  for (let i = 0; i < n; i++) sumW += ws[i];
  const avgConf = weights ? sumW / n : 1;
  return {
    joint: feat.name,
    label: feat.label,
    meanDeltaDeg: +meanAbs.toFixed(2),
    maxDeltaDeg: +weightedPercentile(diffsAbs, ws, 0.9).toFixed(2),
    proMeanDeg: +weightedTrimmedMean(pros, ws, 0.1).toFixed(2),
    userMeanDeg: +weightedTrimmedMean(users, ws, 0.1).toFixed(2),
    signedBiasDeg: +signedBias.toFixed(2),
    // Significance is driven by the systematic offset (|bias|), not the
    // noise-inflated mean abs delta — see significance(). A joint backed by too
    // little detection confidence is never flagged (its angle is unreliable).
    significance: avgConf < VIS_THRESHOLD ? "low" : significance(Math.abs(signedBias)),
    // Persisted so the coach can tell a "low" that means WELL-MATCHED from a
    // "low" that means NOT-SEEN (its fallback must never train unseen joints).
    avgConf: +avgConf.toFixed(3),
  };
}

/** Max (pro, you) skeleton pairs persisted for the visual mesh comparison. The
 * scrubber doesn't need every aligned frame; ~40 keeps the record small while
 * still showing the whole motion smoothly. */
const MAX_MESH_PAIRS = 40;

/** Round a landmark for compact persistence (sub-mm precision is irrelevant for
 * a screen-space skeleton, and full doubles would bloat every saved record). */
function roundLm(l: Landmark3D, vis: number): { x: number; y: number; z: number; visibility: number } {
  return {
    x: +l.x.toFixed(4),
    y: +l.y.toFixed(4),
    z: +l.z.toFixed(4),
    visibility: +vis.toFixed(2),
  };
}
/**
 * Persist a cleaned pose with the RAW frame's visibility. Gap-filling launders
 * visibility up to anchor level (deliberately, so interpolated geometry stays
 * usable in the angle math), which means the cleaned frames carry no trace of
 * which limbs were fabricated. The mesh the user SEES must keep the honest
 * signal: drawSkeleton hides sub-threshold limbs, and its promise that
 * "occluded or interpolated limbs aren't drawn as confident lines" only holds
 * if the persisted visibility is the detector's, not the interpolator's.
 */
function roundPose(f: PoseFrame, raw?: PoseFrame): MeshPose {
  return f.map((lm, i) => {
    const rawVis = raw?.[i]?.visibility;
    const vis = Math.min(lm.visibility ?? 1, rawVis ?? 1);
    return roundLm(lm, vis);
  });
}

/**
 * Build the persisted skeleton data the result screen renders. The landmarks are
 * already extracted for the comparison; without this they'd be discarded and the
 * user would never see the mesh the app is named for. We store a downsampled,
 * time-aligned set of (pro, you) pose pairs — sampled along the DTW path so each
 * scrubber position shows MATCHED poses — plus the contact/release index as the
 * default view + thumbnail frame.
 */
function buildMesh(
  mode: "sequence" | "single_frame",
  proFrames: PoseFrame[],
  userFrames: PoseFrame[],
  rawPro: PoseFrame[],
  rawUser: PoseFrame[],
  path: [number, number][],
  keyUserFrame: number | null,
  phases: PhaseSummary[],
): MeshComparison | null {
  if (mode === "single_frame") {
    if (proFrames.length === 0 || userFrames.length === 0) return null;
    const u = keyUserFrame ?? 0;
    return {
      pairs: [
        {
          pro: roundPose(proFrames[0], rawPro[0]),
          user: roundPose(userFrames[u] ?? userFrames[0], rawUser[u] ?? rawUser[0]),
        },
      ],
      keyIndex: 0,
    };
  }
  if (path.length === 0) return null;
  const count = Math.min(MAX_MESH_PAIRS, path.length);
  const sampled: number[] = [];
  for (let s = 0; s < count; s++) {
    sampled.push(count === 1 ? 0 : Math.round((s * (path.length - 1)) / (count - 1)));
  }
  const pairs = sampled.map((pi) => {
    const [i, j] = path[pi];
    return {
      pro: roundPose(proFrames[i], rawPro[i]),
      user: roundPose(userFrames[j], rawUser[j]),
    };
  });
  // Default the scrubber to the contact/release moment (or the load phase) so the
  // user lands on the most coaching-relevant pose; fall back to the middle.
  const anchor = phases.find((p) => p.name === "release") ?? phases.find((p) => p.name === "load");
  let keyIndex = Math.floor(pairs.length / 2);
  if (anchor) {
    const mid = (anchor.startFrame + anchor.endFrame) / 2;
    let best = Infinity;
    sampled.forEach((pi, k) => {
      const d = Math.abs(path[pi][0] - mid);
      if (d < best) {
        best = d;
        keyIndex = k;
      }
    });
  }
  return { pairs, keyIndex };
}

/**
 * Compare two pose sequences and produce an AnalysisReport.
 * Guide + workouts are left null/empty here — that's the coach engine's job.
 */
export function compare(input: CompareInput): AnalysisReport {
  const { sport, shot } = input;
  // Both sides need at least one pose frame. An empty sequence otherwise yields
  // an undefined single_frame target / paired row that crashes the per-joint
  // accumulation downstream. The app's extractors guard upstream (image: throws
  // "Could not detect a pose"; video: zero-coverage guard), but compare() is a
  // public, unit-tested entry point and must fail loudly rather than crash.
  if (input.pro.frames.length === 0 || input.user.frames.length === 0) {
    throw new Error(
      "compare(): both the pro and user must have at least one pose frame.",
    );
  }
  // Clean the raw landmark streams before any geometry is computed:
  //   1. fillGaps  — repair missing/occluded landmarks (e.g. all-zero frames
  //      from detection dropouts) so they don't inject spurious "fully
  //      extended" joint angles into the comparison.
  //   2. despikeFrames — repair physically impossible high-confidence landmark
  //      jumps (detector glitches that visibility weighting cannot see) BEFORE
  //      smoothing smears them across neighbouring frames.
  //   3. smoothFrames — remove single-frame detector jitter so angle deltas
  //      reflect real movement. A 1-frame video / single image is a no-op.
  // Detection coverage is measured on the RAW frames (before gap-filling) so it
  // reflects how much real signal there was vs. how much was interpolated.
  const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
  const keyType = jointType(sport.keyJoint);
  let rawPro = input.pro.frames;
  let rawUser = input.user.frames;
  let proFrames = normalizeAll(smoothFrames(despikeFrames(fillGaps(rawPro))));
  let userFrames = normalizeAll(smoothFrames(despikeFrames(fillGaps(rawUser))));

  // Crop both clips to their ACTIVE window before anything is compared. DTW is
  // endpoint-anchored, so idle pre/post-roll in one clip (standing at address,
  // walking back after the shot) would be crammed against the other clip's real
  // motion at full detection confidence — fabricating systematic "standing vs
  // swinging" joint biases and collapsing the score. The window is found from
  // each clip's own key-joint speed profile and is conservative: clips with no
  // usable peak come back untouched (see activeWindow). Raw frames are cropped
  // with the same window so confidence/mesh indices stay aligned.
  // Each clip's dominant side is detected ONCE (full clip, before cropping) and
  // reused for the crop, handedness, and phase anchoring. Re-detecting after
  // the crop could disagree with the side the crop itself was keyed on,
  // leaving the window and the phases anchored to different joints.
  const cropToActive = (
    frames: PoseFrame[],
    raw: PoseFrame[],
    fps: number,
  ): [PoseFrame[], PoseFrame[], Side] => {
    const side = detectDominantSide(frames, keyType);
    const w = activeWindow(frames, sidedJoint(side, keyType), fps);
    if (w.start === 0 && w.end === frames.length - 1) return [frames, raw, side];
    return [frames.slice(w.start, w.end + 1), raw.slice(w.start, w.end + 1), side];
  };
  let proSideFromClip: Side | null = null;
  let userSideFromClip: Side | null = null;
  if (input.pro.kind === "video" && proFrames.length > 1) {
    [proFrames, rawPro, proSideFromClip] = cropToActive(proFrames, rawPro, input.pro.fps);
  }
  if (userFrames.length > 1) {
    [userFrames, rawUser, userSideFromClip] = cropToActive(userFrames, rawUser, input.user.fps);
  }

  // Detection coverage over the segment actually compared (RAW frames, before
  // gap-filling, so it reflects real signal vs interpolation).
  const coverage = {
    pro: +detectionCoverage(rawPro, CORE).toFixed(3),
    user: +detectionCoverage(rawUser, CORE).toFixed(3),
  };
  // Per-frame, per-feature detection confidence, from the RAW frames so
  // gap-filled (synthetic) samples keep their honest low visibility. Frame
  // counts are preserved by the cleanup steps, so indices line up with the
  // angle sequences. Confidence vectors mirror with the same column swaps as
  // the angle vectors.
  const proConf = featureConfidenceSequence(rawPro);
  const userConfRaw = featureConfidenceSequence(rawUser);
  const proRep = repairImplausible(computeAnglesSequence(proFrames), proConf);
  const userRep = repairImplausible(computeAnglesSequence(userFrames), userConfRaw);
  const proAngles = proRep.seq;
  const userAnglesRaw = userRep.seq;
  // Repaired frames are synthetic (interpolated/edge-held across a depth-flip
  // run) yet carried the flip frames' original — high — detector confidence.
  // Cap them at the TTA-disagreement level (below VIS_THRESHOLD) so fabricated
  // values can't steer the alignment or the deltas at full weight. Done AFTER
  // repair so the cap can't disturb the repair's own anchor selection, and
  // BEFORE mirroring so the mirrored confidence copy inherits it.
  const REPAIRED_CONF_CAP = 0.25;
  const capRepaired = (conf: number[][], repaired: boolean[]) => {
    for (let i = 0; i < conf.length; i++) {
      if (!repaired[i]) continue;
      conf[i] = conf[i].map((c) => Math.min(c, REPAIRED_CONF_CAP));
    }
  };
  capRepaired(proConf, proRep.repaired);
  capRepaired(userConfRaw, userRep.repaired);
  const userConfMirrored = mirrorAnglesSequence(userConfRaw);

  // single_frame only for an actual pro IMAGE or a genuinely single-frame clip.
  // A 2-frame video used to be downgraded here too (proAngles.length <= 2),
  // which silently discarded its second frame and all alignment/phases; a
  // 2-frame video can still form a (trivial) DTW path, so keep it in sequence
  // mode and only collapse to single_frame when there is literally one frame.
  const mode: "sequence" | "single_frame" =
    input.pro.kind === "image" || proAngles.length < 2 ? "single_frame" : "sequence";

  // Handedness: infer each athlete's dominant side from how much the sport's
  // key joint (e.g. the racket wrist, the kicking ankle) moves. If they differ,
  // mirror the user's angle features to the pro's convention so a left-handed
  // athlete is compared limb-for-limb against a right-handed pro. Mirroring is a
  // column swap on the angle vector — see handedness.ts.
  // Motion-energy handedness for the user clip — used only by single-frame
  // mode, where there is no alignment to resolve orientation from directly.
  // Sequence mode infers the user's side from the best-matching orientation.
  let userSide = userSideFromClip ?? detectDominantSide(userFrames, keyType);
  const userAnglesMirrored = mirrorAnglesSequence(userAnglesRaw);
  const opposite = (s: Side): Side => (s === "right" ? "left" : "right");

  // proSide / mirrored / userAngles are decided per-mode below: a single pro
  // image carries no motion to infer handedness from, so we resolve it from the
  // match itself rather than hard-defaulting (which would mirror every
  // left-handed user against a right-handed assumption).
  let proSide: Side;
  let mirrored: boolean;
  let userAngles: number[][];

  let path: [number, number][] = [];
  let distance = 0;
  let similarity: number[] = [];
  let keyUserFrame: number | null = null;

  let pairedPro: number[][] = [];
  let pairedUser: number[][] = [];
  // Per-pair, per-feature weight: a pairing is only as reliable as the less
  // visible of its two frames, so weight = min(pro conf, user conf).
  let pairedW: number[][] = [];
  const pairWeight = (confA: number[], confB: number[]): number[] =>
    JOINT_FEATURES.map((_, f) => Math.min(confA[f], confB[f]));

  if (mode === "sequence") {
    // The pro's dominant side comes from motion energy (pro reference clips are
    // well-framed, single-athlete footage). Whether the USER must be mirrored is
    // resolved from the match itself — align both orientations and keep the
    // closer one — exactly like single-frame mode. Motion-energy argmax on the
    // user clip proved too thin a margin on real footage (near-symmetric
    // recoveries flip the call and silently mirror a same-handed athlete,
    // collapsing the comparison); best-of-both-alignments has no such knife edge:
    // when the two orientations genuinely tie, either choice compares
    // near-symmetric sides and changes almost nothing.
    proSide = proSideFromClip ?? detectDominantSide(proFrames, keyType);
    // Align on the confidence-weighted standardized feature distance so no
    // single wide-range joint dominates the warp path, blown-out frames are
    // clamped, and features neither clip could actually see don't steer the
    // alignment or the score (see weightedStandardizedDistance). Similarity
    // uses the same metric for consistency.
    const proAug = augmentWithConf(proAngles, proConf);
    const userAugRaw = augmentWithConf(userAnglesRaw, userConfRaw);
    const userAugMir = augmentWithConf(userAnglesMirrored, userConfMirrored);
    const dtwOpts = { bandRatio: 0.25, distance: weightedStandardizedDistance };
    const resRaw = dtw(proAug, userAugRaw, dtwOpts);
    const resMir = dtw(proAug, userAugMir, dtwOpts);
    mirrored = resMir.distance < resRaw.distance;
    userSide = mirrored ? opposite(proSide) : proSide;
    userAngles = mirrored ? userAnglesMirrored : userAnglesRaw;
    const userAug = mirrored ? userAugMir : userAugRaw;
    const userConf = mirrored ? userConfMirrored : userConfRaw;
    const result = mirrored ? resMir : resRaw;
    path = result.path;
    distance = result.distance;
    similarity = similarityTimeline(proAug, userAug, path, "s1", SIM_NORM, weightedStandardizedDistance);
    // Build paired feature arrays along the path.
    pairedPro = path.map(([i]) => proAngles[i]);
    pairedUser = path.map(([, j]) => userAngles[j]);
    pairedW = path.map(([i, j]) => pairWeight(proConf[i], userConf[j]));
  } else {
    // Single-frame mode. Pro has 1 frame and thus no motion to infer its
    // handedness from. Try both orientations of the user sequence and keep
    // whichever produces the closer best-frame match — this resolves unknown
    // pro-image handedness directly from the data, with no free parameters.
    // The match runs on the confidence-weighted distance so an occluded or
    // despiked low-visibility user frame can't win the match on garbage.
    const target = augmentWithConf([proAngles[0]], [proConf[0]])[0];
    const bestMatch = (
      seq: number[][],
    ): { indices: number[]; dist: number } => {
      const dists: number[] = [];
      for (let i = 0; i < seq.length; i++) {
        const d = weightedStandardizedDistance(target, seq[i]);
        dists.push(d);
      }
      // Score on the mean of the best ~5% of frames (min 1), not the single
      // best frame. A best-of-N minimum over hundreds of frames is an order
      // statistic, not an estimate: even an unrelated motion contains ONE frame
      // that happens to resemble the pro image, which systematically inflated
      // image-mode scores relative to sequence-mode scores. Averaging a small
      // top set keeps "the user actually passes through the pro's position"
      // scoring high while a single lucky frame no longer carries the score.
      const k = Math.max(1, Math.round(seq.length * 0.05));
      const indices = dists
        .map((_, i) => i)
        .sort((a, b) => dists[a] - dists[b])
        .slice(0, k);
      const dist = indices.reduce((sum, i) => sum + dists[i], 0) / indices.length;
      return { indices, dist };
    };
    const raw = bestMatch(augmentWithConf(userAnglesRaw, userConfRaw));
    const mir = bestMatch(augmentWithConf(userAnglesMirrored, userConfMirrored));
    mirrored = mir.dist < raw.dist;
    // The pro's inferred side is whatever orientation matched: if mirroring the
    // user matched better, the two have opposite handedness.
    proSide = mirrored ? opposite(userSide) : userSide;
    userAngles = mirrored ? userAnglesMirrored : userAnglesRaw;
    const chosen = mirrored ? mir : raw;
    keyUserFrame = chosen.indices[0];
    // Use the same best-frame cohort for joint statistics that produced the
    // headline distance. Previously the score averaged the best ~5% to resist
    // a lucky one-frame match, but the coaching deltas still used only that
    // single luckiest frame. A long unrelated clip could therefore receive a
    // guarded low score while claiming every joint matched perfectly. The mesh
    // and keyUserFrame remain the single closest pose for a clear snapshot.
    pairedPro = chosen.indices.map(() => proAngles[0]);
    pairedUser = chosen.indices.map((i) => userAngles[i]);
    const userConf = mirrored ? userConfMirrored : userConfRaw;
    pairedW = chosen.indices.map((i) => pairWeight(proConf[0], userConf[i]));
    distance = chosen.dist;
    similarity = [similarityFromDistance(chosen.dist)];
  }

  const handedness: Handedness = { pro: proSide, user: userSide, mirrored };
  // Phase detection anchors on the PRO's actual dominant-side key joint.
  const phaseKeyJoint = sidedJoint(proSide, keyType);

  // Per-joint deltas across the paired samples.
  const perJointPro: number[][] = JOINT_FEATURES.map(() => []);
  const perJointUser: number[][] = JOINT_FEATURES.map(() => []);
  const perJointW: number[][] = JOINT_FEATURES.map(() => []);
  for (let k = 0; k < pairedPro.length; k++) {
    for (let f = 0; f < JOINT_FEATURES.length; f++) {
      perJointPro[f].push(pairedPro[k][f]);
      perJointUser[f].push(pairedUser[k][f]);
      perJointW[f].push(pairedW[k][f]);
    }
  }
  const jointDeltas = JOINT_FEATURES.map((_, f) =>
    buildDelta(f, perJointPro[f], perJointUser[f], perJointW[f]),
  );

  // Phase summaries (only meaningful in sequence mode).
  const phases: PhaseSummary[] = [];
  if (mode === "sequence") {
    const proPhases = detectPhases(proFrames, phaseKeyJoint, input.pro.fps);
    for (const ph of proPhases) {
      const subsetIdx: number[] = [];
      for (let k = 0; k < path.length; k++) {
        const [i] = path[k];
        if (i >= ph.startFrame && i <= ph.endFrame) subsetIdx.push(k);
      }
      if (subsetIdx.length === 0) continue;
      const proSub = subsetIdx.map((k) => pairedPro[k]);
      const userSub = subsetIdx.map((k) => pairedUser[k]);
      const wSub = subsetIdx.map((k) => pairedW[k]);
      const phaseDeltas = JOINT_FEATURES.map((_, f) =>
        buildDelta(
          f,
          proSub.map((row) => row[f]),
          userSub.map((row) => row[f]),
          wSub.map((row) => row[f]),
        ),
      );
      phases.push({
        name: ph.name,
        startFrame: ph.startFrame,
        endFrame: ph.endFrame,
        topDeltas: sortedByImpact(phaseDeltas).slice(0, 4),
        note: describePhase(ph, phaseKeyJoint),
      });
    }
  }
  // NOTE: significance and ranking stay on the OVERALL systematic bias. We
  // deliberately do NOT upgrade them from per-phase biases: on real footage the
  // short, motion-blurred contact (release) phase — where the distal landmarks
  // are least visible — produces large but unreliable per-phase biases that
  // would re-introduce exactly the noise the bias-centric scoring removes
  // (validated against pro-vs-same-pro footage). The phase with the largest
  // systematic gap is still surfaced descriptively (see coach worstPhaseFor) to
  // localize a flagged fault, just not used to flag or rank it.

  // Overall similarity: blend of the timeline mean and its 10th percentile,
  // floored at 0. A plain time-average dilutes localized failures — a clip
  // whose 80 setup frames match at 0.95 but whose 10-frame CONTACT is
  // completely wrong still averaged ~0.87, hiding exactly the moment that
  // matters most in a swing. Folding in the worst-decile similarity makes a
  // localized breakdown register while leaving uniformly-good clips untouched
  // (mean == p10 == overall for a flat timeline, so self-comparison stays 1.0).
  let overall = 0;
  if (similarity.length > 0) {
    const mean = similarity.reduce((a, b) => a + b, 0) / similarity.length;
    const p10 = percentile(similarity, 0.1);
    // 80/20 keeps the score anchored to the validated whole-motion rubric
    // while still letting a localized breakdown move the headline number.
    overall = Math.max(0, Math.min(1, 0.8 * mean + 0.2 * p10));
  }

  const mesh = buildMesh(
    mode,
    proFrames,
    userFrames,
    rawPro,
    rawUser,
    path,
    keyUserFrame,
    phases,
  );

  return {
    version: 1,
    sport,
    shot,
    mode,
    proFps: input.pro.fps,
    userFps: input.user.fps,
    proFrameCount: proFrames.length,
    userFrameCount: userFrames.length,
    // Source-clip durations: the active-window crop shortens the COMPARED frame
    // arrays, but the reported duration describes the clip the user recorded.
    durationSecPro: input.pro.frames.length / Math.max(input.pro.fps, 1),
    durationSecUser: input.user.frames.length / Math.max(input.user.fps, 1),
    alignment:
      mode === "sequence"
        ? { path, distance: +distance.toFixed(3), similarityTimeline: similarity }
        : null,
    keyUserFrame,
    handedness,
    coverage,
    overallSimilarity: +overall.toFixed(3),
    jointDeltas: sortedByImpact(jointDeltas),
    phases,
    mesh,
    guide: null,
    workouts: [],
  };
}

function describePhase(p: Phase, key: JointName): string {
  switch (p.name) {
    case "preparation":
      return "Early setup and body orientation before the motion loads.";
    case "load":
      return "The coiled position just before explosive movement — where potential energy builds.";
    case "release":
      return `Peak velocity of the ${key.replace("_", " ")} — contact or release point.`;
    case "follow_through":
      return "Deceleration and balance recovery after release.";
    default:
      return "";
  }
}
