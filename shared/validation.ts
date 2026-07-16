import type {
  AnalysisReport,
  ImprovementGuide,
  JointDelta,
  JointName,
  MeshComparison,
  PhaseSummary,
  SportId,
  SportMeta,
  Workout,
  WorkoutStep,
} from "./types";

const SPORT_IDS: ReadonlySet<string> = new Set<SportId>([
  "tennis",
  "basketball",
  "golf",
  "baseball",
  "soccer",
  "boxing",
  "volleyball",
  "swimming",
  "custom",
]);

const JOINT_NAMES: ReadonlySet<string> = new Set<JointName>([
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "trunk_rotation",
  "trunk_lean",
  "shoulder_line_tilt",
]);

const SIGNIFICANCE = new Set(["low", "medium", "high"]);
const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
export const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonNegativeNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const isProbability = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;

export const isSportId = (value: unknown): value is SportId =>
  isString(value) && SPORT_IDS.has(value);

export const isJointName = (value: unknown): value is JointName =>
  isString(value) && JOINT_NAMES.has(value);

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

export const isTheme = (value: unknown): value is "dark" | "light" =>
  value === "dark" || value === "light";

/** Timestamps emitted by Date#toISOString. Keeping this exact avoids ambiguous
 * locale dates reaching the renderer and displaying as "Invalid Date". */
export const isIsoTimestamp = (value: unknown): value is string => {
  if (!isString(value) || value.length !== 24) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

/** Thumbnails are generated locally as raster canvas data URLs. Reject SVG,
 * HTML, arbitrary data URLs, and malformed base64 at the persistence boundary. */
export const isRasterImageDataUrl = (value: unknown): value is string =>
  isString(value) &&
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);

function isSportMeta(value: unknown): value is SportMeta {
  if (!isObject(value)) return false;
  return (
    isSportId(value.id) &&
    isNonEmptyString(value.name) &&
    isStringArray(value.shots) &&
    isJointName(value.keyJoint) &&
    isString(value.description)
  );
}

function isJointDelta(value: unknown): value is JointDelta {
  if (!isObject(value)) return false;
  return (
    isJointName(value.joint) &&
    isNonEmptyString(value.label) &&
    isFiniteNumber(value.meanDeltaDeg) &&
    isFiniteNumber(value.maxDeltaDeg) &&
    isFiniteNumber(value.proMeanDeg) &&
    isFiniteNumber(value.userMeanDeg) &&
    isFiniteNumber(value.signedBiasDeg) &&
    isString(value.significance) &&
    SIGNIFICANCE.has(value.significance) &&
    (value.avgConf === undefined || isProbability(value.avgConf))
  );
}

function isPhaseSummary(value: unknown): value is PhaseSummary {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.name) &&
    isNonNegativeInteger(value.startFrame) &&
    isNonNegativeInteger(value.endFrame) &&
    value.endFrame >= value.startFrame &&
    Array.isArray(value.topDeltas) &&
    value.topDeltas.every(isJointDelta) &&
    (value.note === undefined || isString(value.note))
  );
}

function isWorkoutStep(value: unknown): value is WorkoutStep {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.name) &&
    isString(value.description) &&
    (value.sets === undefined ||
      (Number.isInteger(value.sets) && (value.sets as number) > 0)) &&
    (value.reps === undefined || isString(value.reps)) &&
    (value.durationSec === undefined ||
      (isFiniteNumber(value.durationSec) && value.durationSec > 0)) &&
    (value.cues === undefined || isStringArray(value.cues))
  );
}

export function isWorkout(value: unknown): value is Workout {
  if (!isObject(value)) return false;
  const stepArray = (candidate: unknown) =>
    Array.isArray(candidate) && candidate.every(isWorkoutStep);
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isString(value.focus) &&
    isNonNegativeNumber(value.durationMin) &&
    isString(value.difficulty) &&
    DIFFICULTIES.has(value.difficulty) &&
    isStringArray(value.equipment) &&
    stepArray(value.warmup) &&
    stepArray(value.main) &&
    stepArray(value.cooldown) &&
    Array.isArray(value.targetsJoints) &&
    value.targetsJoints.every(isJointName) &&
    (value.targetsMuscles === undefined || isStringArray(value.targetsMuscles)) &&
    (value.notes === undefined || isString(value.notes))
  );
}

function isImprovementGuide(value: unknown): value is ImprovementGuide {
  if (!isObject(value)) return false;
  return (
    isString(value.summary) &&
    isStringArray(value.strengths) &&
    Array.isArray(value.keyIssues) &&
    value.keyIssues.every(
      (issue) =>
        isObject(issue) &&
        isNonEmptyString(issue.title) &&
        (issue.joint === undefined || isJointName(issue.joint)) &&
        isString(issue.observation) &&
        isString(issue.cause) &&
        isString(issue.fix) &&
        (issue.muscles === undefined || isStringArray(issue.muscles)),
    ) &&
    isStringArray(value.drills) &&
    isStringArray(value.cues)
  );
}

function isMeshComparison(value: unknown): value is MeshComparison {
  if (!isObject(value) || !Array.isArray(value.pairs)) return false;
  const isPose = (pose: unknown) =>
    Array.isArray(pose) &&
    pose.length === 33 &&
    pose.every(
      (landmark) =>
        isObject(landmark) &&
        isFiniteNumber(landmark.x) &&
        isFiniteNumber(landmark.y) &&
        isFiniteNumber(landmark.z) &&
        isProbability(landmark.visibility),
    );
  return (
    value.pairs.every(
      (pair) => isObject(pair) && isPose(pair.pro) && isPose(pair.user),
    ) &&
    isNonNegativeInteger(value.keyIndex) &&
    (value.pairs.length === 0
      ? value.keyIndex === 0
      : value.keyIndex < value.pairs.length)
  );
}

function isAlignment(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.path)) return false;
  return (
    value.path.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        isNonNegativeInteger(pair[0]) &&
        isNonNegativeInteger(pair[1]),
    ) &&
    isNonNegativeNumber(value.distance) &&
    Array.isArray(value.similarityTimeline) &&
    value.similarityTimeline.every(isProbability)
  );
}

/** Full runtime guard for data crossing IPC or coming back from SQLite.
 * TypeScript types disappear at both boundaries, so every field dereferenced by
 * the renderer must be proven before a record is allowed into the store. */
export function isAnalysisReport(value: unknown): value is AnalysisReport {
  if (!isObject(value)) return false;
  return (
    value.version === 1 &&
    isSportMeta(value.sport) &&
    isNonEmptyString(value.shot) &&
    (value.mode === "sequence" || value.mode === "single_frame") &&
    isNonNegativeNumber(value.proFps) &&
    isNonNegativeNumber(value.userFps) &&
    isNonNegativeInteger(value.proFrameCount) &&
    isNonNegativeInteger(value.userFrameCount) &&
    isNonNegativeNumber(value.durationSecPro) &&
    isNonNegativeNumber(value.durationSecUser) &&
    (value.alignment === null || isAlignment(value.alignment)) &&
    (value.keyUserFrame === null || isNonNegativeInteger(value.keyUserFrame)) &&
    (value.handedness === undefined ||
      (isObject(value.handedness) &&
        (value.handedness.pro === "left" || value.handedness.pro === "right") &&
        (value.handedness.user === "left" || value.handedness.user === "right") &&
        typeof value.handedness.mirrored === "boolean")) &&
    (value.coverage === undefined ||
      (isObject(value.coverage) &&
        isProbability(value.coverage.pro) &&
        isProbability(value.coverage.user))) &&
    isProbability(value.overallSimilarity) &&
    Array.isArray(value.jointDeltas) &&
    value.jointDeltas.every(isJointDelta) &&
    Array.isArray(value.phases) &&
    value.phases.every(isPhaseSummary) &&
    (value.mesh === undefined || value.mesh === null || isMeshComparison(value.mesh)) &&
    (value.guide === null || isImprovementGuide(value.guide)) &&
    Array.isArray(value.workouts) &&
    value.workouts.every(isWorkout)
  );
}
