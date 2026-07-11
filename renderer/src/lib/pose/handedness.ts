import type { JointName } from "@shared/types";
import type { PoseFrame } from "./types";
import { L } from "./types";
import { VIS_THRESHOLD } from "./prepare";

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

/** Median of three — the width-3 median filter kernel. */
const med3 = (a: number, b: number, c: number) =>
  Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/**
 * Kinetic energy of a landmark's median-filtered xy trajectory: Σ (per-frame
 * displacement)² over runs of consecutive SEEN frames.
 *
 * Three deliberate choices, each validated against real court footage where
 * the naive positional-variance version picked the wrong arm on 3 of 8 clips:
 *
 * - Only frames where the landmark was actually seen. A never-visible off-side
 *   wrist still gets positions from the detector — hallucinated guesses whose
 *   spread is fabricated "motion" that can out-vote the real working limb and
 *   flip the handedness call (and everything keyed on it: the active-window
 *   crop, phase anchoring, single-frame mirroring).
 * - A width-3 median filter on positions before differencing. The detector
 *   sometimes confuses the two arms for a frame (mid-clip L/R label flip); the
 *   off-arm landmark then jumps across the body and back — an out-and-back
 *   spike that a variance or path-length metric reads as enormous motion. The
 *   median filter removes single-frame spikes exactly while leaving monotone
 *   swing motion untouched.
 * - Summed squared speed rather than positional spread. Spread prefers the off
 *   arm's wide-but-slow unit-turn sweep and scores an idle-then-explosive
 *   swing near zero; kinetic energy weights the fast racket-arm frames where
 *   the actual work happens. z is excluded — by far the noisiest axis of the
 *   monocular depth estimate.
 */
function motionEnergy(frames: PoseFrame[], idx: number): number {
  // Split into runs of consecutively-seen frames; never difference across an
  // unseen gap (the re-appearance jump is not motion).
  let energy = 0;
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    // Width-3 median filter (endpoints pass through).
    const s = run.map(([x, y], i) =>
      i === 0 || i === run.length - 1
        ? [x, y]
        : [med3(run[i - 1][0], x, run[i + 1][0]), med3(run[i - 1][1], y, run[i + 1][1])],
    );
    for (let i = 1; i < s.length; i++) {
      energy += (s[i][0] - s[i - 1][0]) ** 2 + (s[i][1] - s[i - 1][1]) ** 2;
    }
    run = [];
  };
  for (const f of frames) {
    const l = f[idx];
    if ((l?.visibility ?? 0) >= VIS_THRESHOLD) run.push([l.x, l.y]);
    else flush();
  }
  flush();
  return energy;
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
