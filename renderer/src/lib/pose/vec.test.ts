import { describe, expect, it } from "vitest";
import { angleBetweenDeg, cross, normalize, norm, signedAngleDeg, sub } from "./vec";

describe("vec", () => {
  it("angleBetweenDeg on orthogonal vectors = 90", () => {
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90, 4);
  });

  it("angleBetweenDeg on parallel vectors = 0", () => {
    expect(angleBetweenDeg({ x: 1, y: 2, z: 3 }, { x: 2, y: 4, z: 6 })).toBeCloseTo(0, 4);
  });

  it("angleBetweenDeg on anti-parallel vectors = 180", () => {
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBeCloseTo(180, 4);
  });

  it("angleBetweenDeg on zero vector = 0 (safe)", () => {
    expect(angleBetweenDeg({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(0);
  });

  it("normalize returns unit vector", () => {
    const n = normalize({ x: 3, y: 0, z: 4 });
    expect(norm(n)).toBeCloseTo(1, 6);
  });

  it("cross of x and y = z (right-handed)", () => {
    const c = cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(c).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("signedAngleDeg on xy plane with +z axis is signed correctly", () => {
    // rotating x -> y about +z is positive
    const a = signedAngleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(a).toBeCloseTo(90, 4);
    // reverse direction is negative
    const b = signedAngleDeg({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(b).toBeCloseTo(-90, 4);
  });

  it("sub subtracts componentwise", () => {
    expect(sub({ x: 5, y: 7, z: 9 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 5, z: 6 });
  });
});
