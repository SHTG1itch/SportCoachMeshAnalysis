import { describe, expect, it } from "vitest";
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { __testing } from "./landmarker";
import { L, type PoseFrame } from "./types";

const { mergeTta, toFrame, unmirrorFrame, TTA_AGREE_M } = __testing;

function frame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: i * 0.01, y: 1 - i * 0.01, z: i * 0.002, visibility: 0.9 });
  return f;
}

function resultFrame(
  world: Array<{ x: number; y: number; z: number; visibility?: number }>,
  imageVisibility: number[] = [],
): PoseLandmarkerResult {
  return {
    worldLandmarks: [world],
    landmarks: [world.map((l, i) => ({
      ...l,
      visibility: imageVisibility[i],
    }))],
  } as unknown as PoseLandmarkerResult;
}

describe("toFrame", () => {
  it("uses finite image-space visibility as a fallback and clamps probabilities", () => {
    const world: Array<{ x: number; y: number; z: number; visibility?: number }> =
      frame().map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));
    world[0].visibility = undefined;
    world[1].visibility = Number.NaN;
    world[2].visibility = 4;
    world[3].visibility = -2;

    const converted = toFrame(resultFrame(world, [0.65, 0.45]));

    expect(converted?.[0].visibility).toBe(0.65);
    expect(converted?.[1].visibility).toBe(0.45);
    expect(converted?.[2].visibility).toBe(1);
    expect(converted?.[3].visibility).toBe(0);
  });

  it("turns non-finite coordinates into an honestly missing landmark", () => {
    const world = frame().map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));
    world[L.LEFT_WRIST] = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      z: 0,
      visibility: 0.99,
    };

    const converted = toFrame(resultFrame(world));

    expect(converted?.[L.LEFT_WRIST]).toEqual({ x: 0, y: 0, z: 0, visibility: 0 });
  });

  it("rejects incomplete world-landmark output", () => {
    const short = frame().slice(0, 32);
    expect(toFrame(resultFrame(short))).toBeNull();
  });
});

describe("unmirrorFrame", () => {
  it("negates x and swaps left/right partners", () => {
    const f = frame();
    f[L.LEFT_WRIST] = { x: 0.4, y: 0.8, z: 0.1, visibility: 0.7 };
    f[L.RIGHT_WRIST] = { x: -0.3, y: 0.9, z: 0.2, visibility: 0.6 };
    const u = unmirrorFrame(f);
    // The mirrored detection's RIGHT wrist is the athlete's LEFT wrist, with x negated.
    expect(u[L.LEFT_WRIST]).toEqual({ x: 0.3, y: 0.9, z: 0.2, visibility: 0.6 });
    expect(u[L.RIGHT_WRIST]).toEqual({ x: -0.4, y: 0.8, z: 0.1, visibility: 0.7 });
  });

  it("keeps the unpaired nose landmark, x negated", () => {
    const f = frame();
    f[L.NOSE] = { x: 0.05, y: 1.5, z: 0, visibility: 1 };
    const u = unmirrorFrame(f);
    expect(u[L.NOSE]).toEqual({ x: -0.05, y: 1.5, z: 0, visibility: 1 });
  });

  it("is an involution: applying twice returns the original frame", () => {
    const f = frame();
    const round = unmirrorFrame(unmirrorFrame(f));
    for (let i = 0; i < 33; i++) {
      expect(round[i].x).toBeCloseTo(f[i].x, 12);
      expect(round[i].y).toBeCloseTo(f[i].y, 12);
      expect(round[i].z).toBeCloseTo(f[i].z, 12);
      expect(round[i].visibility).toBe(f[i].visibility);
    }
  });
});

describe("mergeTta", () => {
  it("averages position and visibility when the two estimates agree", () => {
    const a = frame();
    const b = frame();
    a[L.LEFT_ELBOW] = { x: 0.10, y: 1.00, z: 0.00, visibility: 0.8 };
    b[L.LEFT_ELBOW] = { x: 0.14, y: 1.02, z: 0.02, visibility: 0.6 };
    const m = mergeTta(a, b);
    expect(m[L.LEFT_ELBOW].x).toBeCloseTo(0.12, 9);
    expect(m[L.LEFT_ELBOW].y).toBeCloseTo(1.01, 9);
    expect(m[L.LEFT_ELBOW].z).toBeCloseTo(0.01, 9);
    expect(m[L.LEFT_ELBOW].visibility).toBeCloseTo(0.7, 9);
  });

  it("keeps the primary position but caps visibility below the usability threshold on disagreement", () => {
    const a = frame();
    const b = frame();
    a[L.LEFT_ELBOW] = { x: 0.1, y: 1.0, z: 0.0, visibility: 0.9 };
    // Far beyond TTA_AGREE_M away — a flip-style disagreement.
    b[L.LEFT_ELBOW] = { x: 0.1 + 3 * TTA_AGREE_M, y: 1.0, z: 0.0, visibility: 0.5 };
    const m = mergeTta(a, b);
    expect(m[L.LEFT_ELBOW].x).toBeCloseTo(0.1, 9);
    // A disagreement means the detector can't reproduce the landmark under a
    // mirror — the sample must fall below VIS_THRESHOLD (0.3) so gap-filling
    // and confidence weighting actually treat it as unreliable.
    expect(m[L.LEFT_ELBOW].visibility).toBeLessThan(0.3);
    // ...but an already-low pair visibility is preserved, not raised.
    b[L.LEFT_ELBOW].visibility = 0.1;
    expect(mergeTta(a, b)[L.LEFT_ELBOW].visibility).toBeCloseTo(0.1, 9);
  });

  it("merging two identical frames is the identity", () => {
    const a = frame();
    const m = mergeTta(a, frame());
    for (let i = 0; i < 33; i++) {
      expect(m[i].x).toBeCloseTo(a[i].x, 12);
      expect(m[i].visibility).toBeCloseTo(a[i].visibility, 12);
    }
  });
});
