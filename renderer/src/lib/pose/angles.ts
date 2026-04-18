import type { JointName } from "@shared/types";
import type { PoseFrame } from "./types";
import { L } from "./types";
import { angleBetweenDeg, sub, type Vec3 } from "./vec";

/** Ordered list of joint features we compute per frame. */
export const JOINT_FEATURES: { name: JointName; label: string }[] = [
  { name: "left_elbow", label: "Left elbow flexion" },
  { name: "right_elbow", label: "Right elbow flexion" },
  { name: "left_shoulder", label: "Left shoulder abduction" },
  { name: "right_shoulder", label: "Right shoulder abduction" },
  { name: "left_hip", label: "Left hip flexion" },
  { name: "right_hip", label: "Right hip flexion" },
  { name: "left_knee", label: "Left knee flexion" },
  { name: "right_knee", label: "Right knee flexion" },
  { name: "left_ankle", label: "Left ankle dorsiflexion" },
  { name: "right_ankle", label: "Right ankle dorsiflexion" },
  { name: "trunk_rotation", label: "Trunk rotation (shoulders vs hips)" },
  { name: "hip_rotation", label: "Hip rotation (yaw)" },
  { name: "shoulder_line_tilt", label: "Shoulder line tilt" },
];

function asVec(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Compute one feature vector of joint angles (degrees) for a single pose frame.
 * Order matches JOINT_FEATURES. Returns 0 for landmarks with low visibility
 * so downstream code can treat missing data as "no signal".
 */
export function computeAngles(frame: PoseFrame): number[] {
  const out: number[] = [];
  const getV = (i: number): Vec3 => asVec(frame[i]);

  // Elbow flexion: angle at elbow between upper arm and forearm (180° = fully extended).
  // We report (180 - a) so 0° = straight arm, 180° = fully bent.
  const elbow = (sh: number, el: number, wr: number): number => {
    const upper = sub(getV(sh), getV(el));
    const fore = sub(getV(wr), getV(el));
    return 180 - angleBetweenDeg(upper, fore);
  };
  out.push(elbow(L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST));
  out.push(elbow(L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST));

  // Shoulder abduction: angle between torso axis and upper arm.
  const shoulderAb = (shoulder: number, hip: number, elbow: number): number => {
    const torso = sub(getV(shoulder), getV(hip));
    const upper = sub(getV(elbow), getV(shoulder));
    return angleBetweenDeg(torso, upper);
  };
  out.push(shoulderAb(L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_ELBOW));
  out.push(shoulderAb(L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_ELBOW));

  // Hip flexion: angle at hip between torso (shoulder-hip) and thigh (hip-knee).
  // 0 = thigh aligned with torso (fully flexed), 180 = straight (standing).
  const hipFlex = (shoulder: number, hip: number, knee: number): number => {
    const torso = sub(getV(shoulder), getV(hip));
    const thigh = sub(getV(knee), getV(hip));
    return 180 - angleBetweenDeg(torso, thigh);
  };
  out.push(hipFlex(L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE));
  out.push(hipFlex(L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE));

  // Knee flexion: 0 = straight leg, 180 = fully bent.
  const knee = (hip: number, knee: number, ankle: number): number => {
    const thigh = sub(getV(hip), getV(knee));
    const shin = sub(getV(ankle), getV(knee));
    return 180 - angleBetweenDeg(thigh, shin);
  };
  out.push(knee(L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE));
  out.push(knee(L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE));

  // Ankle dorsiflexion: angle between shin and foot.
  const ankle = (knee: number, ankle: number, foot: number): number => {
    const shin = sub(getV(knee), getV(ankle));
    const footV = sub(getV(foot), getV(ankle));
    return angleBetweenDeg(shin, footV);
  };
  out.push(ankle(L.LEFT_KNEE, L.LEFT_ANKLE, L.LEFT_FOOT_INDEX));
  out.push(ankle(L.RIGHT_KNEE, L.RIGHT_ANKLE, L.RIGHT_FOOT_INDEX));

  // Trunk rotation: yaw angle between shoulder-line and hip-line projected onto
  // the horizontal plane (axis = vertical).
  const shoulderLine = sub(getV(L.RIGHT_SHOULDER), getV(L.LEFT_SHOULDER));
  const hipLine = sub(getV(L.RIGHT_HIP), getV(L.LEFT_HIP));
  const vertical: Vec3 = { x: 0, y: 1, z: 0 };
  // Project both onto horizontal plane (remove y component) and measure unsigned angle.
  const shFlat: Vec3 = { x: shoulderLine.x, y: 0, z: shoulderLine.z };
  const hipFlat: Vec3 = { x: hipLine.x, y: 0, z: hipLine.z };
  out.push(angleBetweenDeg(shFlat, hipFlat));

  // Hip rotation (yaw): angle of hip-line vs world x-axis in horizontal plane.
  out.push(angleBetweenDeg(hipFlat, { x: 1, y: 0, z: 0 }));

  // Shoulder line tilt: angle between shoulder line and horizontal.
  // 0 = perfectly level, 90 = vertical.
  out.push(
    Math.abs(90 - angleBetweenDeg(shoulderLine, vertical)),
  );

  // Suppress obviously-missing features. Visibility check on the two shoulders
  // and two hips — if any core landmark is invisible, zero out rotation features.
  const viz = [
    frame[L.LEFT_SHOULDER].visibility,
    frame[L.RIGHT_SHOULDER].visibility,
    frame[L.LEFT_HIP].visibility,
    frame[L.RIGHT_HIP].visibility,
  ];
  if (viz.some((v) => v < 0.4)) {
    out[10] = 0;
    out[11] = 0;
    out[12] = 0;
  }

  return out;
}

export function computeAnglesSequence(frames: PoseFrame[]): number[][] {
  return frames.map(computeAngles);
}
