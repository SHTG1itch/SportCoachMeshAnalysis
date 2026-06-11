import { describe, expect, it } from "vitest";
import { dtw, euclidean } from "./dtw";

describe("dtw", () => {
  it("identical sequences produce zero distance and diagonal path", () => {
    const a = [[0], [1], [2], [3]];
    const b = [[0], [1], [2], [3]];
    const { path, distance } = dtw(a, b);
    expect(distance).toBe(0);
    expect(path).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("sequences with simple time-warp align correctly", () => {
    // b is a "slower" version of a: each value held for 2 frames.
    const a = [[0], [1], [2], [3]];
    const b = [[0], [0], [1], [1], [2], [2], [3], [3]];
    const { path, distance } = dtw(a, b, { bandRatio: 1 });
    expect(distance).toBe(0);
    // Path should be monotonic and cover both sequences fully.
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([a.length - 1, b.length - 1]);
    let prev = path[0];
    for (let k = 1; k < path.length; k++) {
      expect(path[k][0]).toBeGreaterThanOrEqual(prev[0]);
      expect(path[k][1]).toBeGreaterThanOrEqual(prev[1]);
      prev = path[k];
    }
  });

  it("shifted sequences have positive but small distance", () => {
    const a = [[0], [1], [2], [3], [4]];
    const b = [[1], [2], [3], [4], [5]];
    const { distance } = dtw(a, b);
    // Every aligned pair differs by ~1 except possible endpoint doubling.
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(2);
  });

  it("euclidean distance is correct", () => {
    expect(euclidean([3, 0], [0, 4])).toBeCloseTo(5, 6);
  });

  it("reaches the endpoint for length-mismatched clips at the DEFAULT band", () => {
    // Two clips of the SAME motion at different tempo/fps: `a` is 15 frames,
    // `b` is the same ramp captured at 2x the frame rate (each value held for
    // two frames) = 30 frames. |15 - 30| = 15 exceeds the old ratio-only band
    // (floor(30 * 0.25) = 7), which left cost[15][30] = Infinity and produced a
    // degenerate path that dropped the first 15 reference frames. With the band
    // floored at |n - m| the optimal full-coverage alignment is recovered.
    const a: number[][] = [];
    for (let i = 0; i < 15; i++) a.push([i]);
    const b: number[][] = [];
    for (let i = 0; i < 15; i++) {
      b.push([i]);
      b.push([i]);
    }
    const { path, distance } = dtw(a, b); // default bandRatio (0.25)
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeCloseTo(0, 6); // every b frame matches an a frame exactly
    // The path must span BOTH corners and stay monotonic.
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([a.length - 1, b.length - 1]);
    let prev = path[0];
    for (let k = 1; k < path.length; k++) {
      expect(path[k][0]).toBeGreaterThanOrEqual(prev[0]);
      expect(path[k][1]).toBeGreaterThanOrEqual(prev[1]);
      prev = path[k];
    }
    // Every reference frame of `a` is covered by at least one path step (no
    // silently-dropped frames that would zero out the similarity timeline).
    const coveredA = new Set(path.map(([i]) => i));
    expect(coveredA.size).toBe(a.length);
  });

  it("handles the longer-user case symmetrically (n < m and n > m)", () => {
    const short = [[0], [2], [4], [6]];
    const long = [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]];
    for (const [s1, s2] of [
      [short, long],
      [long, short],
    ] as const) {
      const { path, distance } = dtw(s1, s2);
      expect(Number.isFinite(distance)).toBe(true);
      expect(path[0]).toEqual([0, 0]);
      expect(path[path.length - 1]).toEqual([s1.length - 1, s2.length - 1]);
    }
  });
});
