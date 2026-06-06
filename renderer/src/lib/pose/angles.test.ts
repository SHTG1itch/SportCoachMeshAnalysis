import { describe, expect, it } from "vitest";
import { computeAngles, computeAnglesSequence, detectUpSign, JOINT_FEATURES } from "./angles";
import { L, type PoseFrame } from "./types";

function mkFrame(overrides: Partial<Record<number, [number, number, number]>>): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) {
    f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  for (const [idxStr, coords] of Object.entries(overrides)) {
    if (!coords) continue;
    const idx = Number(idxStr);
    f[idx] = { x: coords[0], y: coords[1], z: coords[2], visibility: 1 };
  }
  return f;
}

describe("computeAngles", () => {
  it("returns one value per feature", () => {
    const f = mkFrame({});
    const out = computeAngles(f);
    expect(out).toHaveLength(JOINT_FEATURES.length);
  });

  it("right elbow fully extended (straight line) = 0° flexion", () => {
    // Arrange shoulder, elbow, wrist colinear on +x axis.
    const f = mkFrame({
      [L.RIGHT_SHOULDER]: [0, 1, 0],
      [L.RIGHT_ELBOW]: [1, 1, 0],
      [L.RIGHT_WRIST]: [2, 1, 0],
      [L.LEFT_SHOULDER]: [0, 1, 0.1],
      [L.LEFT_HIP]: [0, 0, 0.1],
      [L.RIGHT_HIP]: [0, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_elbow");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("right elbow at 90°: upper arm on +x, forearm on +y", () => {
    const f = mkFrame({
      [L.RIGHT_SHOULDER]: [0, 1, 0],
      [L.RIGHT_ELBOW]: [1, 1, 0],
      [L.RIGHT_WRIST]: [1, 2, 0],
      [L.LEFT_SHOULDER]: [0, 1, 0.1],
      [L.LEFT_HIP]: [0, 0, 0.1],
      [L.RIGHT_HIP]: [0, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_elbow");
    expect(out[idx]).toBeCloseTo(90, 3);
  });

  it("knee straight = 0° flexion", () => {
    const f = mkFrame({
      [L.LEFT_HIP]: [0, 1, 0],
      [L.LEFT_KNEE]: [0, 0.5, 0],
      [L.LEFT_ANKLE]: [0, 0, 0],
      [L.LEFT_SHOULDER]: [0, 2, 0],
      [L.RIGHT_SHOULDER]: [0.3, 2, 0],
      [L.RIGHT_HIP]: [0.3, 1, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "left_knee");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("trunk rotation ~ 0 when shoulders parallel to hips", () => {
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-1, 2, 0],
      [L.RIGHT_SHOULDER]: [1, 2, 0],
      [L.LEFT_HIP]: [-1, 0, 0],
      [L.RIGHT_HIP]: [1, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("trunk lean = 0 when torso is vertical", () => {
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("trunk lean ~ 45° when torso leans forward 45°", () => {
    // Shoulder midpoint pushed forward (+z) by the same amount it is above hips.
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 1],
      [L.RIGHT_SHOULDER]: [0.2, 2, 1],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    expect(out[idx]).toBeCloseTo(45, 3);
  });

  it("trunk lean is invariant to camera yaw (rotation about vertical)", () => {
    const base = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0.7],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0.7],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const leanBase = computeAngles(base)[idx];
    // Rotate the whole pose 50° about the vertical (y) axis — a pure change of
    // camera facing. Trunk lean (measured against gravity) must not move.
    const theta = (50 * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rotated: PoseFrame = base.map((p) => ({
      x: p.x * cos + p.z * sin,
      y: p.y,
      z: -p.x * sin + p.z * cos,
      visibility: p.visibility,
    }));
    const leanRot = computeAngles(rotated)[idx];
    expect(leanRot).toBeCloseTo(leanBase, 3);
  });

  it("detectUpSign: -1 for y-down (MediaPipe) world coords, +1 for y-up", () => {
    // y-DOWN: shoulders physically above hips => smaller (more negative) y.
    const down = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, -0.5, 0],
      [L.RIGHT_SHOULDER]: [0.2, -0.5, 0],
      [L.LEFT_HIP]: [-0.2, 0, 0],
      [L.RIGHT_HIP]: [0.2, 0, 0],
    });
    expect(detectUpSign([down, down, down])).toBe(-1);
    const up = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    expect(detectUpSign([up, up, up])).toBe(1);
  });

  it("trunk lean reads ~upright for y-DOWN data via computeAnglesSequence", () => {
    // Near-upright torso with a slight forward (+z) lean, in MediaPipe's y-DOWN
    // world frame (shoulders above hips => negative y).
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, -1, 0.1],
      [L.RIGHT_SHOULDER]: [0.2, -1, 0.1],
      [L.LEFT_HIP]: [-0.2, 0, 0],
      [L.RIGHT_HIP]: [0.2, 0, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const seq = computeAnglesSequence([f, f, f]);
    expect(seq[0][idx]).toBeLessThan(20); // small lean — NOT the ~180° sign-flip
    // The per-frame default (upSign = +1) would mis-read the same data as inverted.
    expect(computeAngles(f)[idx]).toBeGreaterThan(150);
  });

  it("trunk rotation ~ 90° when shoulders rotated 90° to hips", () => {
    const f = mkFrame({
      // hips along x axis
      [L.LEFT_HIP]: [-1, 0, 0],
      [L.RIGHT_HIP]: [1, 0, 0],
      // shoulders along z axis (projected horizontal)
      [L.LEFT_SHOULDER]: [0, 2, -1],
      [L.RIGHT_SHOULDER]: [0, 2, 1],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    expect(out[idx]).toBeCloseTo(90, 3);
  });
});
