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
});
