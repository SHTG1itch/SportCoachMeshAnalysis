import { describe, expect, it } from "vitest";
import { detectPhases, type Phase } from "./phases";
import type { PoseFrame } from "./types";
import { L } from "./types";

/** A 33-landmark frame whose right wrist sits at (x,0,0); everything else fixed. */
function frameWithWrist(x: number): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  f[L.RIGHT_WRIST] = { x, y: 0, z: 0, visibility: 1 };
  return f;
}

/** Assert the phases form a contiguous, non-overlapping partition of [0, n-1]. */
function assertPartition(phases: Phase[], n: number): void {
  const sorted = [...phases].sort((a, b) => a.startFrame - b.startFrame);
  expect(sorted.length).toBeGreaterThan(0);
  expect(sorted[0].startFrame).toBe(0);
  expect(sorted[sorted.length - 1].endFrame).toBe(n - 1);
  for (const p of sorted) {
    expect(p.startFrame).toBeGreaterThanOrEqual(0);
    expect(p.endFrame).toBeLessThanOrEqual(n - 1);
    expect(p.endFrame).toBeGreaterThanOrEqual(p.startFrame);
  }
  for (let k = 1; k < sorted.length; k++) {
    // Each phase begins exactly one frame after the previous one ends — no gaps,
    // no overlaps (so no frame is ever double-counted across phases).
    expect(sorted[k].startFrame).toBe(sorted[k - 1].endFrame + 1);
  }
}

describe("detectPhases", () => {
  it("partitions a clip with a clear velocity peak into ordered, non-overlapping phases", () => {
    // Wrist accelerates to a peak around frame 15 then decelerates.
    const xs: number[] = [];
    let x = 0;
    for (let i = 0; i < 30; i++) {
      x += 1 + 19 * Math.exp(-((i - 15) ** 2) / 8);
      xs.push(x);
    }
    const phases = detectPhases(xs.map(frameWithWrist), "right_wrist", 30);
    assertPartition(phases, 30);
    expect(phases.some((p) => p.name === "release")).toBe(true);
    expect(phases.some((p) => p.name === "follow_through")).toBe(true);
  });

  it("does not emit overlapping phases when there is no clear peak (flat speed)", () => {
    // Regression: a motionless key joint collapses releaseStart === releaseEnd ===
    // peak, which previously produced a release window and a follow_through that
    // shared a frame. The partition must stay clean.
    const frames = Array.from({ length: 30 }, () => frameWithWrist(5));
    const phases = detectPhases(frames, "right_wrist", 30);
    assertPartition(phases, 30);
  });

  it("returns a single 'full' phase for clips too short to segment", () => {
    const phases = detectPhases([frameWithWrist(0), frameWithWrist(1)], "right_wrist", 30);
    expect(phases).toEqual([{ name: "full", startFrame: 0, endFrame: 1 }]);
  });

  it("falls back to a single 'full' phase when the key joint has no landmark", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frameWithWrist(i));
    // trunk_rotation is a valid JointName but maps to no single landmark.
    const phases = detectPhases(frames, "trunk_rotation", 30);
    expect(phases).toEqual([{ name: "full", startFrame: 0, endFrame: 9 }]);
  });
});
