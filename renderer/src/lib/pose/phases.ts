import type { PoseFrame } from "./types";
import { L } from "./types";
import type { JointName } from "@shared/types";

// Every sided body part handedness.ts can pick as a key joint, so phase
// detection anchors on the actual moving joint for ALL sports (not just the
// wrist/ankle/elbow trio) — otherwise a shoulder/hip/knee-keyed sport silently
// degrades to a single "full" phase.
const JOINT_TO_LANDMARK: Partial<Record<JointName, number>> = {
  left_wrist: L.LEFT_WRIST,
  right_wrist: L.RIGHT_WRIST,
  left_elbow: L.LEFT_ELBOW,
  right_elbow: L.RIGHT_ELBOW,
  left_shoulder: L.LEFT_SHOULDER,
  right_shoulder: L.RIGHT_SHOULDER,
  left_hip: L.LEFT_HIP,
  right_hip: L.RIGHT_HIP,
  left_knee: L.LEFT_KNEE,
  right_knee: L.RIGHT_KNEE,
  left_ankle: L.LEFT_ANKLE,
  right_ankle: L.RIGHT_ANKLE,
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
/** Smoothed per-frame speed profile of a key landmark (~100 ms window). */
function smoothedKeySpeed(
  frames: PoseFrame[],
  lm: number,
  fps: number,
): Float64Array {
  const n = frames.length;
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
  speeds[0] = speeds[1] ?? 0;

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
  return sm;
}

/** A frame is "active" when the key joint moves faster than this fraction of
 * its peak smoothed speed. Well below any real motion phase (the release scan
 * uses 50%), so only genuinely idle footage — standing at address, walking
 * back after the follow-through — falls outside the window. */
const ACTIVE_SPEED_FRACTION = 0.12;
/** Keep this much context (seconds) on each side of the active window, so the
 * preparation's stillness-to-motion transition survives the trim. */
const ACTIVE_PAD_SEC = 0.35;

/**
 * The [start, end] frame range in which the motion actually happens.
 *
 * Why: DTW is endpoint-anchored — frame 0 of one clip MUST pair with frame 0
 * of the other. Untrimmed idle pre/post-roll (a user filming 6 s of standing
 * before a 2 s swing) gets crammed against the other clip's real motion at
 * full detection confidence, fabricating systematic "standing vs swinging"
 * joint biases and collapsing the similarity score. Comparing motions, not
 * recordings, requires both clips cropped to their motion first.
 *
 * Conservative by construction: the whole clip is returned when the speed
 * profile has no usable peak (static pose, unknown key joint, tiny clip) or
 * when the trim would leave too little signal.
 */
export function activeWindow(
  frames: PoseFrame[],
  keyJoint: JointName,
  fps: number,
): { start: number; end: number } {
  const n = frames.length;
  const full = { start: 0, end: n - 1 };
  if (n < 8) return full;
  const lm = JOINT_TO_LANDMARK[keyJoint];
  if (lm === undefined) return full;
  const sm = smoothedKeySpeed(frames, lm, fps);
  let peak = 0;
  for (let i = 0; i < n; i++) if (sm[i] > peak) peak = sm[i];
  if (!(peak > 0)) return full;
  const thr = peak * ACTIVE_SPEED_FRACTION;
  let start = 0;
  while (start < n && sm[start] < thr) start++;
  let end = n - 1;
  while (end > start && sm[end] < thr) end--;
  const pad = Math.round(ACTIVE_PAD_SEC * Math.max(fps, 1));
  start = Math.max(0, start - pad);
  end = Math.min(n - 1, end + pad);
  // Never trim down to a sliver — a window this short means the "motion" was
  // noise, not signal, and the full clip is the safer comparison.
  if (end - start + 1 < Math.max(4, Math.floor(n * 0.1))) return full;
  return { start, end };
}

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

  const sm = smoothedKeySpeed(frames, lm, fps);

  // Find peak.
  let peak = 0;
  let peakVal = -1;
  for (let i = 0; i < n; i++) {
    if (sm[i] > peakVal) {
      peakVal = sm[i];
      peak = i;
    }
  }
  // A perfectly static key joint has no motion to segment: without this guard
  // the half-peak scans (0 < 0 never true) label the ENTIRE clip "release",
  // which downstream copy then treats as the contact moment.
  if (!(peakVal > 0)) {
    return [{ name: "full", startFrame: 0, endFrame: n - 1 }];
  }

  // Half-peak crossings. A clip that starts (or ends) mid-swing may never drop
  // below half-peak on that side — the old code then left releaseStart AT the
  // peak, which pushed the contact frame itself out of the release window and
  // into preparation/load (release starts at releaseStart + 1). When no
  // crossing exists, the release must extend to the clip edge instead.
  const half = peakVal * 0.5;
  let releaseStart = -1; // "no crossing": release starts at frame 0
  for (let i = peak; i >= 0; i--) {
    if (sm[i] < half) {
      releaseStart = i;
      break;
    }
  }
  let releaseEnd = n - 1; // "no crossing": release runs to the last frame
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
  // `relEnd` is the last frame of the release window; follow_through must start
  // strictly after it. When there is no clear velocity peak (flat speed profile),
  // releaseStart and releaseEnd both collapse to the peak frame, and a raw
  // `releaseEnd + 1` follow_through start would overlap the forced one-frame
  // release window. Partitioning on `relEnd` keeps the phases non-overlapping so
  // no frame is double-counted (and the per-phase frame ranges shown in the UI
  // never overlap).
  const relEnd = Math.min(n - 1, Math.max(releaseStart + 1, releaseEnd));
  phases.push({
    name: "release",
    startFrame: releaseStart + 1,
    endFrame: relEnd,
  });
  if (relEnd < n - 1) {
    phases.push({
      name: "follow_through",
      startFrame: relEnd + 1,
      endFrame: n - 1,
    });
  }
  return phases.filter((p) => p.endFrame >= p.startFrame);
}
