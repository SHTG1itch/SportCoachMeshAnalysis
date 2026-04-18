import type { PoseFrame } from "./types";
import { L } from "./types";
import type { JointName } from "@shared/types";

const JOINT_TO_LANDMARK: Partial<Record<JointName, number>> = {
  left_wrist: L.LEFT_WRIST,
  right_wrist: L.RIGHT_WRIST,
  left_ankle: L.LEFT_ANKLE,
  right_ankle: L.RIGHT_ANKLE,
  left_elbow: L.LEFT_ELBOW,
  right_elbow: L.RIGHT_ELBOW,
};

export interface Phase {
  name: string;
  startFrame: number;
  endFrame: number;
}

/**
 * Decompose a motion into phases based on the speed profile of a key joint.
 *
 * Algorithm:
 * 1. Compute per-frame speed of the key landmark.
 * 2. Smooth with a short moving average.
 * 3. Find the global peak frame (this is typically contact / release).
 * 4. Find the half-peak crossings on either side to delimit the release.
 * 5. Everything before = preparation/load. Everything after = follow-through.
 *
 * This gives four phases per shot, which is what coaching rubrics use for
 * swinging/striking sports. For sports without a clear peak the phases still
 * partition the sequence — the peak just lands somewhere meaningful.
 */
export function detectPhases(
  frames: PoseFrame[],
  keyJoint: JointName,
  fps: number,
): Phase[] {
  const n = frames.length;
  if (n < 4) {
    return [{ name: "full", startFrame: 0, endFrame: n - 1 }];
  }
  const lm = JOINT_TO_LANDMARK[keyJoint];
  if (lm === undefined) {
    // Fallback: single phase.
    return [{ name: "full", startFrame: 0, endFrame: n - 1 }];
  }

  const dt = 1 / Math.max(fps, 1);
  const speeds = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1][lm];
    const b = frames[i][lm];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    speeds[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
  }
  speeds[0] = speeds[1];

  // Smooth.
  const w = Math.max(1, Math.round(fps / 10)); // ~100ms window
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = i - w; k <= i + w; k++) {
      if (k >= 0 && k < n) {
        s += speeds[k];
        c++;
      }
    }
    sm[i] = s / c;
  }

  // Find peak.
  let peak = 0;
  let peakVal = -1;
  for (let i = 0; i < n; i++) {
    if (sm[i] > peakVal) {
      peakVal = sm[i];
      peak = i;
    }
  }

  // Half-peak crossings.
  const half = peakVal * 0.5;
  let releaseStart = peak;
  for (let i = peak; i >= 0; i--) {
    if (sm[i] < half) {
      releaseStart = i;
      break;
    }
  }
  let releaseEnd = peak;
  for (let i = peak; i < n; i++) {
    if (sm[i] < half) {
      releaseEnd = i;
      break;
    }
  }

  // Preparation = [0, releaseStart].
  // If there's room, split it into preparation + load around its mid.
  const phases: Phase[] = [];
  if (releaseStart > 3) {
    const mid = Math.floor(releaseStart * 0.6);
    phases.push({ name: "preparation", startFrame: 0, endFrame: mid });
    phases.push({ name: "load", startFrame: mid + 1, endFrame: releaseStart });
  } else {
    phases.push({ name: "preparation", startFrame: 0, endFrame: releaseStart });
  }
  phases.push({
    name: "release",
    startFrame: releaseStart + 1,
    endFrame: Math.max(releaseStart + 1, releaseEnd),
  });
  if (releaseEnd < n - 1) {
    phases.push({
      name: "follow_through",
      startFrame: releaseEnd + 1,
      endFrame: n - 1,
    });
  }
  return phases.filter((p) => p.endFrame >= p.startFrame);
}
