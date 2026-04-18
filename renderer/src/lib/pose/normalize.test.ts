import { describe, expect, it } from "vitest";
import { normalizeFrame } from "./normalize";
import { L, type PoseFrame } from "./types";

function frame(shoulderY: number, hipY: number, hipX: number): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  f[L.LEFT_SHOULDER] = { x: -0.2 + hipX, y: shoulderY, z: 0, visibility: 1 };
  f[L.RIGHT_SHOULDER] = { x: 0.2 + hipX, y: shoulderY, z: 0, visibility: 1 };
  f[L.LEFT_HIP] = { x: -0.15 + hipX, y: hipY, z: 0, visibility: 1 };
  f[L.RIGHT_HIP] = { x: 0.15 + hipX, y: hipY, z: 0, visibility: 1 };
  return f;
}

describe("normalizeFrame", () => {
  it("centers hip midpoint at origin", () => {
    const f = frame(2, 1, 5);
    const n = normalizeFrame(f);
    const hipMidX = (n[L.LEFT_HIP].x + n[L.RIGHT_HIP].x) / 2;
    const hipMidY = (n[L.LEFT_HIP].y + n[L.RIGHT_HIP].y) / 2;
    expect(hipMidX).toBeCloseTo(0, 6);
    expect(hipMidY).toBeCloseTo(0, 6);
  });

  it("scales so shoulder-hip distance = 1", () => {
    const f = frame(3, 1, 0); // torso = 2 units
    const n = normalizeFrame(f);
    const shMidY = (n[L.LEFT_SHOULDER].y + n[L.RIGHT_SHOULDER].y) / 2;
    expect(Math.abs(shMidY)).toBeCloseTo(1, 4);
  });

  it("scaled + translated poses produce identical normalized output", () => {
    // Build a proportional pose (all offsets from hip mid scale together).
    const build = (k: number, ox: number, oy: number): PoseFrame => {
      const f: PoseFrame = [];
      for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
      f[L.LEFT_SHOULDER] = { x: ox + k * -0.2, y: oy + k * 1.0, z: 0, visibility: 1 };
      f[L.RIGHT_SHOULDER] = { x: ox + k * 0.2, y: oy + k * 1.0, z: 0, visibility: 1 };
      f[L.LEFT_HIP] = { x: ox + k * -0.15, y: oy + k * 0.0, z: 0, visibility: 1 };
      f[L.RIGHT_HIP] = { x: ox + k * 0.15, y: oy + k * 0.0, z: 0, visibility: 1 };
      return f;
    };
    const n1 = normalizeFrame(build(1, 0, 0));
    const n2 = normalizeFrame(build(3, 17, -9));
    expect(n2[L.LEFT_SHOULDER].x).toBeCloseTo(n1[L.LEFT_SHOULDER].x, 4);
    expect(n2[L.LEFT_SHOULDER].y).toBeCloseTo(n1[L.LEFT_SHOULDER].y, 4);
    expect(n2[L.RIGHT_SHOULDER].x).toBeCloseTo(n1[L.RIGHT_SHOULDER].x, 4);
    expect(n2[L.RIGHT_SHOULDER].y).toBeCloseTo(n1[L.RIGHT_SHOULDER].y, 4);
  });
});
