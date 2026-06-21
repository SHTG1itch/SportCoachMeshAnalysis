import { describe, expect, it } from "vitest";
import { projectPose } from "./render";
import { L, type PoseFrame } from "./types";

/** Standing pose with a configurable vertical sign so we can build both a
 * y-up frame and a (MediaPipe-style) y-down frame from the same layout. */
function standing(ySign: number): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  const set = (i: number, x: number, up: number) => {
    f[i] = { x, y: ySign * up, z: 0, visibility: 1 };
  };
  // `up` is the height above the ground (larger = closer to the head).
  set(L.NOSE, 0, 1.7);
  set(L.LEFT_SHOULDER, -0.2, 1.4);
  set(L.RIGHT_SHOULDER, 0.2, 1.4);
  set(L.LEFT_ELBOW, -0.3, 1.1);
  set(L.RIGHT_ELBOW, 0.3, 1.1);
  set(L.LEFT_WRIST, -0.35, 0.85);
  set(L.RIGHT_WRIST, 0.35, 0.85);
  set(L.LEFT_HIP, -0.15, 0.9);
  set(L.RIGHT_HIP, 0.15, 0.9);
  set(L.LEFT_KNEE, -0.15, 0.5);
  set(L.RIGHT_KNEE, 0.15, 0.5);
  set(L.LEFT_ANKLE, -0.15, 0.05);
  set(L.RIGHT_ANKLE, 0.15, 0.05);
  return f;
}

const W = 300;
const H = 360;

describe("projectPose", () => {
  it("renders the head above the feet for a y-UP frame", () => {
    const pts = projectPose(standing(1), W, H);
    // canvas y grows downward, so 'above' means a SMALLER y.
    expect(pts[L.NOSE].y).toBeLessThan(pts[L.LEFT_ANKLE].y);
    expect(pts[L.LEFT_SHOULDER].y).toBeLessThan(pts[L.LEFT_HIP].y);
  });

  it("renders the head above the feet for a y-DOWN frame (MediaPipe world convention)", () => {
    const pts = projectPose(standing(-1), W, H);
    expect(pts[L.NOSE].y).toBeLessThan(pts[L.LEFT_ANKLE].y);
    expect(pts[L.LEFT_SHOULDER].y).toBeLessThan(pts[L.LEFT_HIP].y);
  });

  it("orients head-up even when the nose landmark is missing (at origin)", () => {
    const f = standing(-1);
    f[L.NOSE] = { x: 0, y: 0, z: 0, visibility: 0 };
    const pts = projectPose(f, W, H);
    expect(pts[L.LEFT_SHOULDER].y).toBeLessThan(pts[L.LEFT_HIP].y);
  });

  it("keeps all visible points within the canvas bounds", () => {
    const pts = projectPose(standing(-1), W, H);
    for (let i = 0; i < pts.length; i++) {
      if ((standing(-1)[i].visibility ?? 1) < 0.3) continue;
      expect(pts[i].x).toBeGreaterThanOrEqual(0);
      expect(pts[i].x).toBeLessThanOrEqual(W);
      expect(pts[i].y).toBeGreaterThanOrEqual(0);
      expect(pts[i].y).toBeLessThanOrEqual(H);
    }
  });

  it("centers the skeleton roughly in the canvas", () => {
    const pts = projectPose(standing(-1), W, H);
    // Hip midpoint should sit near the horizontal center.
    const hipMidX = (pts[L.LEFT_HIP].x + pts[L.RIGHT_HIP].x) / 2;
    expect(Math.abs(hipMidX - W / 2)).toBeLessThan(W * 0.15);
  });
});
