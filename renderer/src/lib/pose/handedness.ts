import type { JointName } from "@shared/types";
import type { PoseFrame } from "./types";
import { L } from "./types";

export type Side = "left" | "right";

/**
 * Left/right landmark indices for each sided body part that a sport might use
 * as its key (motion-defining) joint.
 */
const SIDE_LANDMARKS: Record<string, { left: number; right: number }> = {
  wrist: { left: L.LEFT_WRIST, right: L.RIGHT_WRIST },
  elbow: { left: L.LEFT_ELBOW, right: L.RIGHT_ELBOW },
  shoulder: { left: L.LEFT_SHOULDER, right: L.RIGHT_SHOULDER },
  hip: { left: L.LEFT_HIP, right: L.RIGHT_HIP },
  knee: { left: L.LEFT_KNEE, right: L.RIGHT_KNEE },
  ankle: { left: L.LEFT_ANKLE, right: L.RIGHT_ANKLE },
};

/** The body-part type of a sided joint name, e.g. "right_wrist" -> "wrist". */
export function jointType(joint: JointName): string {
  const parts = joint.split("_");
  return parts[parts.length - 1];
}

/** Compose a sided joint name from a side and a body-part type. */
export function sidedJoint(side: Side, type: string): JointName {
  return `${side}_${type}` as JointName;
}

/**
 * Total positional variance of a landmark over the clip (trace of its
 * covariance, summed over frames). This measures how much the landmark *moves*
 * without accumulating high-frequency jitter the way a path-length sum would —
 * a parameter-free proxy for "which limb is doing the work".
 */
function motionEnergy(frames: PoseFrame[], idx: number): number {
  const n = frames.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const f of frames) {
    mx += f[idx].x;
    my += f[idx].y;
    mz += f[idx].z;
  }
  mx /= n;
  my /= n;
  mz /= n;
  let e = 0;
  for (const f of frames) {
    const dx = f[idx].x - mx;
    const dy = f[idx].y - my;
    const dz = f[idx].z - mz;
    e += dx * dx + dy * dy + dz * dz;
  }
  return e;
}

/**
 * Infer the athlete's dominant side for a given body-part type by comparing how
 * much the left vs right landmark of that type moves across the clip. The side
 * that moves more is the working/dominant side (the racket arm, the kicking
 * leg, …).
 *
 * Parameter-free argmax: when motion is genuinely symmetric the call barely
 * matters, because mirroring two near-symmetric sides changes almost nothing.
 * Defaults to "right" when there is no motion to judge from (e.g. a single
 * still image), matching the sport registry's right-handed defaults.
 */
export function detectDominantSide(frames: PoseFrame[], type: string): Side {
  const lm = SIDE_LANDMARKS[type] ?? SIDE_LANDMARKS.wrist;
  const eRight = motionEnergy(frames, lm.right);
  const eLeft = motionEnergy(frames, lm.left);
  return eRight >= eLeft ? "right" : "left";
}

/**
 * Feature-vector column indices that swap when a pose is mirrored across the
 * sagittal plane. Indices match the order in JOINT_FEATURES; the non-sided
 * features (trunk_rotation, trunk_lean, shoulder_line_tilt) are unsigned and
 * therefore mirror-invariant, so they are not listed.
 */
const SIDED_FEATURE_PAIRS: [number, number][] = [
  [0, 1], // elbow flexion
  [2, 3], // shoulder abduction
  [4, 5], // hip flexion
  [6, 7], // knee flexion
  [8, 9], // ankle dorsiflexion
];

/**
 * Mirror a joint-angle feature vector by swapping its left/right columns.
 *
 * This is the cheap, robust way to compare a left-handed athlete to a
 * right-handed one: rather than mirroring 33 landmarks in MediaPipe's
 * coordinate convention (negate one axis *and* swap L/R indices — easy to get
 * half-right), we swap the already-computed per-side angle features. Flexion
 * magnitudes are side-agnostic, so after the swap a lefty's working-arm angle
 * lines up with a righty's working-arm angle.
 */
export function mirrorAngleVector(v: number[]): number[] {
  const out = v.slice();
  for (const [a, b] of SIDED_FEATURE_PAIRS) {
    out[a] = v[b];
    out[b] = v[a];
  }
  return out;
}

export function mirrorAnglesSequence(seq: number[][]): number[][] {
  return seq.map(mirrorAngleVector);
}
