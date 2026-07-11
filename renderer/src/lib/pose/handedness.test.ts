import { describe, expect, it } from "vitest";
import {
  detectDominantSide,
  jointType,
  sidedJoint,
  mirrorAngleVector,
  mirrorAnglesSequence,
} from "./handedness";
import { computeAngles, JOINT_FEATURES } from "./angles";
import { L, type PoseFrame } from "./types";

function standingFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  f[L.LEFT_SHOULDER] = { x: -0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.RIGHT_SHOULDER] = { x: 0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.LEFT_HIP] = { x: -0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.RIGHT_HIP] = { x: 0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.LEFT_ELBOW] = { x: -0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.RIGHT_ELBOW] = { x: 0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.LEFT_WRIST] = { x: -0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.RIGHT_WRIST] = { x: 0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.LEFT_KNEE] = { x: -0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.RIGHT_KNEE] = { x: 0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.LEFT_ANKLE] = { x: -0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.RIGHT_ANKLE] = { x: 0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.LEFT_FOOT_INDEX] = { x: -0.15, y: 0, z: 0.15, visibility: 1 };
  f[L.RIGHT_FOOT_INDEX] = { x: 0.15, y: 0, z: 0.15, visibility: 1 };
  return f;
}

/** A clip where the chosen wrist swings through a large arc; the other is still. */
function swingSeq(side: "left" | "right"): PoseFrame[] {
  const lm = side === "right" ? L.RIGHT_WRIST : L.LEFT_WRIST;
  return Array.from({ length: 10 }, (_, i) => {
    const f = standingFrame();
    f[lm] = { x: (side === "right" ? 0.35 : -0.35) + i * 0.1, y: 0.85 + i * 0.08, z: 0, visibility: 1 };
    return f;
  });
}

describe("jointType / sidedJoint", () => {
  it("extracts the body-part type and recomposes a sided joint", () => {
    expect(jointType("right_wrist")).toBe("wrist");
    expect(jointType("left_ankle")).toBe("ankle");
    expect(sidedJoint("left", "wrist")).toBe("left_wrist");
    expect(sidedJoint("right", "ankle")).toBe("right_ankle");
  });
});

describe("detectDominantSide", () => {
  it("picks the side whose key landmark moves more", () => {
    expect(detectDominantSide(swingSeq("right"), "wrist")).toBe("right");
    expect(detectDominantSide(swingSeq("left"), "wrist")).toBe("left");
  });
  it("defaults to right when there is no motion (e.g. a still image)", () => {
    expect(detectDominantSide([standingFrame()], "wrist")).toBe("right");
  });

  it("ignores hallucinated motion from a never-seen landmark", () => {
    // Real swing on the RIGHT; the LEFT wrist is occluded the whole clip but
    // the detector still emits wandering positions for it — with even larger
    // variance than the real swing. Visibility gating must keep the fabricated
    // motion from out-voting the working arm.
    const frames = swingSeq("right").map((f, i) => {
      f[L.LEFT_WRIST] = { x: -2 + i * 0.9, y: 2 - i * 0.7, z: i * 0.5, visibility: 0.1 };
      return f;
    });
    expect(detectDominantSide(frames, "wrist")).toBe("right");
  });

  it("is not fooled by label-flip spikes on the off arm", () => {
    // Real swing on the RIGHT. The LEFT wrist mostly idles, but on a few
    // frames the detector confuses the arms and the left landmark jumps to the
    // right wrist's position and back (a mid-clip L/R label flip, seen at full
    // visibility). Under a variance metric those jumps fabricate more "motion"
    // than the actual swing; robust statistics must shrug them off.
    const frames = swingSeq("right").map((f, i) => {
      if (i === 3 || i === 7) {
        f[L.LEFT_WRIST] = { ...f[L.RIGHT_WRIST] };
      }
      return f;
    });
    expect(detectDominantSide(frames, "wrist")).toBe("right");
  });

  it("prefers the fast swinging arm over a wide slow arc on the off arm", () => {
    // Forehand-like clip: the off (left) arm sweeps a wide but SLOW arc during
    // the unit turn — more positional range than the racket wrist — while the
    // right wrist travels less ground but at swing speed. The working arm is
    // the fast one.
    const frames = Array.from({ length: 20 }, (_, i) => {
      const f = standingFrame();
      // Left wrist: wide slow sweep, total 1.0 across 20 frames.
      f[L.LEFT_WRIST] = { x: -0.9 + i * 0.05, y: 0.85, z: 0, visibility: 1 };
      // Right wrist: idle, then a 4-frame explosive swing covering 0.6.
      const swing = i >= 12 && i < 16 ? (i - 12) * 0.2 : i >= 16 ? 0.6 : 0;
      f[L.RIGHT_WRIST] = { x: 0.35 + swing, y: 0.85 - swing * 0.4, z: 0, visibility: 1 };
      return f;
    });
    expect(detectDominantSide(frames, "wrist")).toBe("right");
  });
});

describe("mirrorAngleVector", () => {
  it("swaps every sided feature column and leaves non-sided ones intact", () => {
    const v = JOINT_FEATURES.map((_, i) => i); // [0,1,2,...,12]
    const m = mirrorAngleVector(v);
    // Sided pairs swap.
    expect(m[0]).toBe(1);
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(3);
    expect(m[3]).toBe(2);
    expect(m[8]).toBe(9);
    expect(m[9]).toBe(8);
    // Non-sided features (trunk_rotation, trunk_lean, shoulder_line_tilt) stay.
    expect(m[10]).toBe(10);
    expect(m[11]).toBe(11);
    expect(m[12]).toBe(12);
  });

  it("is an involution (mirroring twice is the identity)", () => {
    const v = JOINT_FEATURES.map((_, i) => i * 7 + 1);
    expect(mirrorAngleVector(mirrorAngleVector(v))).toEqual(v);
  });

  it("makes a left-arm-bent pose match a right-arm-bent mirror", () => {
    // Pose A: right elbow strongly flexed (wrist tucked toward shoulder).
    const a = standingFrame();
    a[L.RIGHT_WRIST] = { x: 0.25, y: 1.35, z: 0, visibility: 1 };
    // Pose B: left elbow flexed the same way (mirror of A).
    const b = standingFrame();
    b[L.LEFT_WRIST] = { x: -0.25, y: 1.35, z: 0, visibility: 1 };

    const angA = computeAngles(a);
    const angB = computeAngles(b);
    // Raw vectors differ (different arm bent)...
    expect(Math.abs(angA[1] - angB[1])).toBeGreaterThan(20); // right elbow column
    // ...but mirroring B aligns it with A.
    const mB = mirrorAngleVector(angB);
    for (let f = 0; f < JOINT_FEATURES.length; f++) {
      expect(mB[f]).toBeCloseTo(angA[f], 5);
    }
  });

  it("mirrorAnglesSequence mirrors each frame", () => {
    const seq = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
    ];
    const m = mirrorAnglesSequence(seq);
    expect(m[0][0]).toBe(1);
    expect(m[1][0]).toBe(11);
  });
});
