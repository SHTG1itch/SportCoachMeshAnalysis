import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import { L, type PoseFrame } from "./types";
import type { SportMeta } from "@shared/types";

function defaultFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) {
    f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  // Basic standing pose.
  f[L.LEFT_SHOULDER] = { x: -0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.RIGHT_SHOULDER] = { x: 0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.LEFT_HIP] = { x: -0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.RIGHT_HIP] = { x: 0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.LEFT_ELBOW] = { x: -0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.RIGHT_ELBOW] = { x: 0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.LEFT_WRIST] = { x: -0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.RIGHT_WRIST] = { x: 0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.LEFT_KNEE] = { x: -0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.RIGHT_KNEE] = { x: 0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.LEFT_ANKLE] = { x: -0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.RIGHT_ANKLE] = { x: 0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.LEFT_FOOT_INDEX] = { x: -0.15, y: 0, z: 0.15, visibility: 1 };
  f[L.RIGHT_FOOT_INDEX] = { x: 0.15, y: 0, z: 0.15, visibility: 1 };
  return f;
}

const SPORT: SportMeta = {
  id: "tennis",
  name: "Tennis",
  shots: ["Forehand"],
  keyJoint: "right_wrist",
  description: "Racket sport",
};

describe("compare", () => {
  it("identical sequences produce ~perfect similarity and low deltas", () => {
    const frames = Array.from({ length: 10 }, () => defaultFrame());
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames, fps: 30, kind: "video" },
      user: { frames: frames.map((f) => f.map((l) => ({ ...l }))), fps: 30 },
    });
    expect(report.overallSimilarity).toBeGreaterThanOrEqual(0.99);
    for (const d of report.jointDeltas) {
      expect(d.meanDeltaDeg).toBeLessThan(0.5);
    }
  });

  it("single-frame mode when pro is an image", () => {
    const pro = defaultFrame();
    const userFrames = Array.from({ length: 10 }, () => defaultFrame());
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: [pro], fps: 1, kind: "image" },
      user: { frames: userFrames, fps: 30 },
    });
    expect(report.mode).toBe("single_frame");
    expect(report.keyUserFrame).not.toBeNull();
    expect(report.alignment).toBeNull();
  });

  it("returns guide=null and workouts=[] (LLM step is separate)", () => {
    const frames = Array.from({ length: 5 }, () => defaultFrame());
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames, fps: 30, kind: "video" },
      user: { frames, fps: 30 },
    });
    expect(report.guide).toBeNull();
    expect(report.workouts).toEqual([]);
  });

  it("larger pose differences → larger deltas", () => {
    const proFrames = Array.from({ length: 6 }, () => defaultFrame());
    // User has right elbow flexed 90° instead of straight.
    const userFrames = proFrames.map((f) => {
      const copy = f.map((l) => ({ ...l }));
      // Bend wrist upward so elbow flexes.
      copy[L.RIGHT_WRIST] = { x: 0.3, y: 1.35, z: 0, visibility: 1 };
      return copy;
    });
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: proFrames, fps: 30, kind: "video" },
      user: { frames: userFrames, fps: 30 },
    });
    const elbow = report.jointDeltas.find((d) => d.joint === "right_elbow");
    expect(elbow).toBeDefined();
    expect(elbow!.meanDeltaDeg).toBeGreaterThan(30);
    expect(["medium", "high"]).toContain(elbow!.significance);
  });
});
