import type {
  AnalysisReport,
  Handedness,
  JointDelta,
  JointName,
  PhaseSummary,
  SportMeta,
} from "@shared/types";
import type { PoseFrame } from "./types";
import { JOINT_FEATURES, computeAnglesSequence } from "./angles";
import { normalizeAll } from "./normalize";
import { fillGaps, smoothFrames, detectionCoverage } from "./prepare";
import { L } from "./types";
import {
  detectDominantSide,
  jointType,
  mirrorAnglesSequence,
  sidedJoint,
  type Side,
} from "./handedness";
import { detectPhases, type Phase } from "./phases";
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
  return c ? sum / c : s[Math.floor(n / 2)];
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
 */
export function repairImplausibleFrames(seq: number[][]): number[][] {
  const n = seq.length;
  if (n === 0 || TRUNK_LEAN_IDX < 0) return seq;
  const F = seq[0].length;
  const out = seq.map((r) => r.slice());
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seq[i][TRUNK_LEAN_IDX] <= TRUNK_LEAN_FLIP_DEG) anchors.push(i);
  }
  if (anchors.length === 0 || anchors.length === n) return out; // all bad (give up) or all good
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < first; i++) out[i][f] = seq[first][f];
    for (let i = last + 1; i < n; i++) out[i][f] = seq[last][f];
    for (let a = 0; a < anchors.length - 1; a++) {
      const lo = anchors[a];
      const hi = anchors[a + 1];
      if (hi - lo <= 1) continue;
      for (let i = lo + 1; i < hi; i++) {
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
 */
function buildDelta(
  featureIdx: number,
  proAngles: number[],
  userAngles: number[],
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
  for (let i = 0; i < n; i++) {
    const d = userAngles[i] - proAngles[i];
    diffsAbs.push(Math.abs(d));
    signed.push(d);
    pros.push(proAngles[i]);
    users.push(userAngles[i]);
  }
  // Robust statistics so a handful of bad frames (detection errors, DTW
  // mis-pairings) can't dominate. meanDeltaDeg is a trimmed mean of the absolute
  // gap; maxDeltaDeg is the 90th percentile ("worst typical" rather than a
  // single-frame spike). Means/bias use trimmed means too. All stay in degrees.
  const meanAbs = trimmedMean(diffsAbs, 0.1);
  const signedBias = trimmedMean(signed, 0.1);
  return {
    joint: feat.name,
    label: feat.label,
    meanDeltaDeg: +meanAbs.toFixed(2),
    maxDeltaDeg: +percentile(diffsAbs, 0.9).toFixed(2),
    proMeanDeg: +trimmedMean(pros, 0.1).toFixed(2),
    userMeanDeg: +trimmedMean(users, 0.1).toFixed(2),
    signedBiasDeg: +signedBias.toFixed(2),
    // Significance is driven by the systematic offset (|bias|), not the
    // noise-inflated mean abs delta — see significance().
    significance: significance(Math.abs(signedBias)),
  };
}

/**
 * Compare two pose sequences and produce an AnalysisReport.
 * Guide + workouts are left null/empty here — that's the LLM's job.
 */
export function compare(input: CompareInput): AnalysisReport {
  const { sport, shot } = input;
  // Clean the raw landmark streams before any geometry is computed:
  //   1. fillGaps  — repair missing/occluded landmarks (e.g. all-zero frames
  //      from detection dropouts) so they don't inject spurious "fully
  //      extended" joint angles into the comparison.
  //   2. smoothFrames — remove single-frame detector jitter so angle deltas
  //      reflect real movement. A 1-frame video / single image is a no-op.
  // Detection coverage is measured on the RAW frames (before gap-filling) so it
  // reflects how much real signal there was vs. how much was interpolated.
  const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
  const coverage = {
    pro: +detectionCoverage(input.pro.frames, CORE).toFixed(3),
    user: +detectionCoverage(input.user.frames, CORE).toFixed(3),
  };
  const proFrames = normalizeAll(smoothFrames(fillGaps(input.pro.frames)));
  const userFrames = normalizeAll(smoothFrames(fillGaps(input.user.frames)));
  const proAngles = repairImplausibleFrames(computeAnglesSequence(proFrames));
  const userAnglesRaw = repairImplausibleFrames(computeAnglesSequence(userFrames));

  const mode: "sequence" | "single_frame" =
    input.pro.kind === "image" || proAngles.length <= 2 ? "single_frame" : "sequence";

  // Handedness: infer each athlete's dominant side from how much the sport's
  // key joint (e.g. the racket wrist, the kicking ankle) moves. If they differ,
  // mirror the user's angle features to the pro's convention so a left-handed
  // athlete is compared limb-for-limb against a right-handed pro. Mirroring is a
  // column swap on the angle vector — see handedness.ts.
  const keyType = jointType(sport.keyJoint);
  const userSide = detectDominantSide(userFrames, keyType);
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

  if (mode === "sequence") {
    // Both clips are videos: dominant side is well-defined from motion energy.
    proSide = detectDominantSide(proFrames, keyType);
    mirrored = proSide !== userSide;
    userAngles = mirrored ? userAnglesMirrored : userAnglesRaw;
    // Align on the standardized feature distance so no single wide-range joint
    // dominates the warp path, and so blown-out frames are clamped (see
    // standardizedDistance). Similarity uses the same metric for consistency.
    const result = dtw(proAngles, userAngles, { bandRatio: 0.25, distance: standardizedDistance });
    path = result.path;
    distance = result.distance;
    similarity = similarityTimeline(proAngles, userAngles, path, "s1", SIM_NORM, standardizedDistance);
    // Build paired feature arrays along the path.
    pairedPro = path.map(([i]) => proAngles[i]);
    pairedUser = path.map(([, j]) => userAngles[j]);
  } else {
    // Single-frame mode. Pro has 1 frame and thus no motion to infer its
    // handedness from. Try both orientations of the user sequence and keep
    // whichever produces the closer best-frame match — this resolves unknown
    // pro-image handedness directly from the data, with no free parameters.
    const target = proAngles[0];
    const bestMatch = (
      seq: number[][],
    ): { idx: number; dist: number } => {
      let idx = 0;
      let dist = Infinity;
      for (let i = 0; i < seq.length; i++) {
        const d = standardizedDistance(target, seq[i]);
        if (d < dist) {
          dist = d;
          idx = i;
        }
      }
      return { idx, dist };
    };
    const raw = bestMatch(userAnglesRaw);
    const mir = bestMatch(userAnglesMirrored);
    mirrored = mir.dist < raw.dist;
    // The pro's inferred side is whatever orientation matched: if mirroring the
    // user matched better, the two have opposite handedness.
    proSide = mirrored ? opposite(userSide) : userSide;
    userAngles = mirrored ? userAnglesMirrored : userAnglesRaw;
    const chosen = mirrored ? mir : raw;
    keyUserFrame = chosen.idx;
    pairedPro = [target];
    pairedUser = [userAngles[chosen.idx]];
    distance = chosen.dist;
    similarity = [similarityFromDistance(chosen.dist)];
  }

  const handedness: Handedness = { pro: proSide, user: userSide, mirrored };
  // Phase detection anchors on the PRO's actual dominant-side key joint.
  const phaseKeyJoint = sidedJoint(proSide, keyType);

  // Per-joint deltas across the paired samples.
  const perJointPro: number[][] = JOINT_FEATURES.map(() => []);
  const perJointUser: number[][] = JOINT_FEATURES.map(() => []);
  for (let k = 0; k < pairedPro.length; k++) {
    for (let f = 0; f < JOINT_FEATURES.length; f++) {
      perJointPro[f].push(pairedPro[k][f]);
      perJointUser[f].push(pairedUser[k][f]);
    }
  }
  const jointDeltas = JOINT_FEATURES.map((_, f) =>
    buildDelta(f, perJointPro[f], perJointUser[f]),
  );

  // Phase summaries (only meaningful in sequence mode).
  const phases: PhaseSummary[] = [];
  if (mode === "sequence") {
    const proPhases = detectPhases(proFrames, phaseKeyJoint, input.pro.fps);
    for (const ph of proPhases) {
      const subset = path.filter(([i]) => i >= ph.startFrame && i <= ph.endFrame);
      if (subset.length === 0) continue;
      const proSub = subset.map(([i]) => proAngles[i]);
      const userSub = subset.map(([, j]) => userAngles[j]);
      const phaseDeltas = JOINT_FEATURES.map((_, f) =>
        buildDelta(
          f,
          proSub.map((row) => row[f]),
          userSub.map((row) => row[f]),
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

  // Overall similarity: mean of timeline, floored at 0.
  const overall =
    similarity.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, similarity.reduce((a, b) => a + b, 0) / similarity.length),
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
    durationSecPro: proFrames.length / Math.max(input.pro.fps, 1),
    durationSecUser: userFrames.length / Math.max(input.user.fps, 1),
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
