import { describe, expect, it } from "vitest";
import { computeAngles, JOINT_FEATURES } from "./angles";
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
