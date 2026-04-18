import type {
  AnalysisReport,
  JointDelta,
  JointName,
  PhaseSummary,
  SportMeta,
} from "@shared/types";
import type { PoseFrame } from "./types";
import { JOINT_FEATURES, computeAnglesSequence } from "./angles";
import { normalizeAll } from "./normalize";
import { detectPhases, type Phase } from "./phases";
import { dtw, euclidean, similarityTimeline } from "./dtw";

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
 * Significance thresholds (degrees of mean absolute delta).
 * Tuned for coaching — a 5° systematic difference in a major joint is usually
 * what a coach would call out.
 */
function significance(meanDelta: number): "low" | "medium" | "high" {
  if (meanDelta >= 15) return "high";
  if (meanDelta >= 7) return "medium";
  return "low";
}

function sortedByImpact(deltas: JointDelta[]): JointDelta[] {
  const weight = (d: JointDelta): number =>
    (d.significance === "high" ? 100 : d.significance === "medium" ? 10 : 1) *
    d.meanDeltaDeg;
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
  let sumAbs = 0;
  let sumSigned = 0;
  let maxAbs = 0;
  let proSum = 0;
  let userSum = 0;
  for (let i = 0; i < n; i++) {
    const d = userAngles[i] - proAngles[i];
    sumAbs += Math.abs(d);
    sumSigned += d;
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    proSum += proAngles[i];
    userSum += userAngles[i];
  }
  const meanAbs = sumAbs / n;
  return {
    joint: feat.name,
    label: feat.label,
    meanDeltaDeg: +meanAbs.toFixed(2),
    maxDeltaDeg: +maxAbs.toFixed(2),
    proMeanDeg: +(proSum / n).toFixed(2),
    userMeanDeg: +(userSum / n).toFixed(2),
    signedBiasDeg: +(sumSigned / n).toFixed(2),
    significance: significance(meanAbs),
  };
}

/**
 * Compare two pose sequences and produce an AnalysisReport.
 * Guide + workouts are left null/empty here — that's the LLM's job.
 */
export function compare(input: CompareInput): AnalysisReport {
  const { sport, shot } = input;
  const proFrames = normalizeAll(input.pro.frames);
  const userFrames = normalizeAll(input.user.frames);
  const proAngles = computeAnglesSequence(proFrames);
  const userAngles = computeAnglesSequence(userFrames);

  const mode: "sequence" | "single_frame" =
    input.pro.kind === "image" || proAngles.length <= 2 ? "single_frame" : "sequence";

  let path: [number, number][] = [];
  let distance = 0;
  let similarity: number[] = [];
  let keyUserFrame: number | null = null;

  let pairedPro: number[][] = [];
  let pairedUser: number[][] = [];

  if (mode === "sequence") {
    const result = dtw(proAngles, userAngles, { bandRatio: 0.25 });
    path = result.path;
    distance = result.distance;
    // Normalizer for similarity: use the 95th percentile of pairwise distances
    // along the path to avoid a handful of extreme deltas squashing the scale.
    const pathDists = path.map(([i, j]) => euclidean(proAngles[i], userAngles[j]));
    const sorted = [...pathDists].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const norm = Math.max(30, p95); // floor so trivially-similar motions don't look perfect
    similarity = similarityTimeline(proAngles, userAngles, path, "s1", norm);
    // Build paired feature arrays along the path.
    pairedPro = path.map(([i]) => proAngles[i]);
    pairedUser = path.map(([, j]) => userAngles[j]);
  } else {
    // Single-frame mode. Pro has 1 frame; find best-matching user frame.
    const target = proAngles[0];
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < userAngles.length; i++) {
      const d = euclidean(target, userAngles[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    keyUserFrame = bestIdx;
    pairedPro = [target];
    pairedUser = [userAngles[bestIdx]];
    distance = bestD;
    similarity = [Math.max(0, 1 - Math.min(1, bestD / 40))];
  }

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
    const proPhases = detectPhases(proFrames, sport.keyJoint, input.pro.fps);
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
        note: describePhase(ph, sport.keyJoint),
      });
    }
  }

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
