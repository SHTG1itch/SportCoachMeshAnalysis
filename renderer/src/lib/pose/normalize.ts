import type { PoseFrame } from "./types";
import { L } from "./types";
import { mid, norm, sub, type Vec3 } from "./vec";

/**
 * Normalize a pose so it is invariant to translation and scale:
 * - origin at hip midpoint
 * - rescaled so shoulder-to-hip midpoint distance = 1
 *
 * This does NOT rotate the pose. Handedness (left vs right) and facing direction
 * are preserved so angle comparisons remain meaningful.
 *
 * MediaPipe world coordinates: +x = person's left, +y = up (gravity down = -y per
 * the docs on image coordinates; world coords use right-hand +y up convention).
 */
export function normalizeFrame(frame: PoseFrame): PoseFrame {
  const ls = frame[L.LEFT_SHOULDER];
  const rs = frame[L.RIGHT_SHOULDER];
  const lh = frame[L.LEFT_HIP];
  const rh = frame[L.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return frame;

  const hipMid: Vec3 = mid(lh, rh);
  const shMid: Vec3 = mid(ls, rs);
  const torso = norm(sub(shMid, hipMid));
  const s = torso > 1e-6 ? 1 / torso : 1;

  return frame.map((lm) => ({
    x: (lm.x - hipMid.x) * s,
    y: (lm.y - hipMid.y) * s,
    z: (lm.z - hipMid.z) * s,
    visibility: lm.visibility,
  }));
}

export function normalizeAll(frames: PoseFrame[]): PoseFrame[] {
  return frames.map(normalizeFrame);
}
