import { describe, expect, it } from "vitest";
import { activeWindow, detectPhases, type Phase } from "./phases";
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

  it("returns a single 'full' phase for a perfectly static key joint", () => {
    // Regression: zero speed everywhere meant the half-peak scans never fired
    // and the ENTIRE clip was labeled "release" — downstream copy then treated
    // all of it as the contact moment.
    const frames = Array.from({ length: 20 }, () => frameWithWrist(3));
    const phases = detectPhases(frames, "right_wrist", 30);
    expect(phases).toEqual([{ name: "full", startFrame: 0, endFrame: 19 }]);
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

  it("keeps the velocity peak inside the release phase even when the clip starts mid-swing", () => {
    // Speed is ABOVE half-peak from frame 0 (no crossing before the peak): the
    // old scan left releaseStart at the peak, pushing the contact frame itself
    // into preparation. Release must instead extend to the clip start.
    const xs: number[] = [];
    let x = 0;
    for (let i = 0; i < 20; i++) {
      x += 10 + 10 * Math.exp(-((i - 2) ** 2) / 4); // peak near frame 2, never < half before it
      xs.push(x);
    }
    const phases = detectPhases(xs.map(frameWithWrist), "right_wrist", 30);
    assertPartition(phases, 20);
    const release = phases.find((p) => p.name === "release");
    expect(release).toBeDefined();
    expect(release!.startFrame).toBe(0); // contains the early peak
  });
});

describe("activeWindow", () => {
  /** Idle, burst of motion, idle: wrist parked, then sweeping, then parked. */
  function paddedClip(idleBefore: number, active: number, idleAfter: number): PoseFrame[] {
    const frames: PoseFrame[] = [];
    for (let i = 0; i < idleBefore; i++) frames.push(frameWithWrist(0));
    for (let i = 0; i < active; i++) frames.push(frameWithWrist(Math.sin((i / active) * Math.PI) * 5));
    for (let i = 0; i < idleAfter; i++) frames.push(frameWithWrist(0));
    return frames;
  }

  it("crops long idle pre/post-roll around the motion", () => {
    const w = activeWindow(paddedClip(60, 30, 60), "right_wrist", 30);
    expect(w.start).toBeGreaterThan(30); // most of the 60 idle lead frames dropped
    expect(w.end).toBeLessThan(120); // most of the 60 idle tail frames dropped
    expect(w.start).toBeLessThanOrEqual(60); // but none of the motion itself
    expect(w.end).toBeGreaterThanOrEqual(89);
  });

  it("returns the whole clip when there is no idle footage", () => {
    const frames = paddedClip(0, 40, 0);
    const w = activeWindow(frames, "right_wrist", 30);
    expect(w.start).toBe(0);
    expect(w.end).toBe(frames.length - 1);
  });

  it("returns the whole clip for static footage and tiny clips", () => {
    const still = Array.from({ length: 30 }, () => frameWithWrist(1));
    expect(activeWindow(still, "right_wrist", 30)).toEqual({ start: 0, end: 29 });
    const tiny = paddedClip(2, 3, 2).slice(0, 6);
    expect(activeWindow(tiny, "right_wrist", 30)).toEqual({ start: 0, end: 5 });
  });
});
