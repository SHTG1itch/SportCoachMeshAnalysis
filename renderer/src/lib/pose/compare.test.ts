import { describe, expect, it } from "vitest";
import { compare, repairImplausibleFrames } from "./compare";
import { JOINT_FEATURES } from "./angles";
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

  it("reports per-clip detection coverage from the raw frames", () => {
    const empty = (): PoseFrame =>
      Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    const proFrames = [defaultFrame(), empty(), defaultFrame(), defaultFrame()]; // 3/4 detected
    const userFrames = Array.from({ length: 4 }, () => defaultFrame()); // 4/4 detected
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: proFrames, fps: 30, kind: "video" },
      user: { frames: userFrames, fps: 30 },
    });
    expect(report.coverage!.pro).toBeCloseTo(0.75, 5);
    expect(report.coverage!.user).toBeCloseTo(1, 5);
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

  it("single-frame: does NOT mirror a left-handed user against a left-handed pro image", () => {
    // Pro still image with the LEFT elbow flexed (a left-handed reference).
    const proImg = defaultFrame();
    proImg[L.LEFT_WRIST] = { x: -0.25, y: 1.35, z: 0, visibility: 1 };
    // Left-dominant user video: the left wrist sweeps; one frame matches the pro.
    const userFrames = Array.from({ length: 10 }, (_, i) => {
      const f = defaultFrame();
      f[L.LEFT_WRIST] = { x: -0.35 + i * 0.02, y: 0.85 + i * 0.06, z: 0, visibility: 1 };
      return f;
    });
    userFrames[5][L.LEFT_WRIST] = { x: -0.25, y: 1.35, z: 0, visibility: 1 };

    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: [proImg], fps: 1, kind: "image" },
      user: { frames: userFrames, fps: 30 },
    });
    expect(report.mode).toBe("single_frame");
    expect(report.handedness!.user).toBe("left");
    // Both are left-handed: the raw (un-mirrored) orientation matches better.
    expect(report.handedness!.mirrored).toBe(false);
    expect(report.handedness!.pro).toBe("left");
  });

  it("single-frame: DOES mirror a left-handed user against a right-handed pro image", () => {
    // Pro still image with the RIGHT elbow flexed (a right-handed reference).
    const proImg = defaultFrame();
    proImg[L.RIGHT_WRIST] = { x: 0.25, y: 1.35, z: 0, visibility: 1 };
    // Left-dominant user; one frame is the mirror image of the pro pose.
    const userFrames = Array.from({ length: 10 }, (_, i) => {
      const f = defaultFrame();
      f[L.LEFT_WRIST] = { x: -0.35 + i * 0.02, y: 0.85 + i * 0.06, z: 0, visibility: 1 };
      return f;
    });
    userFrames[5][L.LEFT_WRIST] = { x: -0.25, y: 1.35, z: 0, visibility: 1 };

    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: [proImg], fps: 1, kind: "image" },
      user: { frames: userFrames, fps: 30 },
    });
    expect(report.handedness!.user).toBe("left");
    expect(report.handedness!.mirrored).toBe(true);
    expect(report.handedness!.pro).toBe("right");
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

  it("matches a left-handed user against a right-handed pro via mirroring", () => {
    // Right/left landmark index pairs that swap under a sagittal mirror.
    const PAIRS: [number, number][] = [
      [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
      [L.LEFT_ELBOW, L.RIGHT_ELBOW],
      [L.LEFT_WRIST, L.RIGHT_WRIST],
      [L.LEFT_HIP, L.RIGHT_HIP],
      [L.LEFT_KNEE, L.RIGHT_KNEE],
      [L.LEFT_ANKLE, L.RIGHT_ANKLE],
      [L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX],
    ];
    const partner = new Map<number, number>();
    for (const [a, b] of PAIRS) {
      partner.set(a, b);
      partner.set(b, a);
    }
    // Geometric mirror: negate x and swap left/right landmark labels.
    const mirrorFrame = (f: PoseFrame): PoseFrame =>
      f.map((_, i) => {
        const src = f[partner.get(i) ?? i];
        return { x: -src.x, y: src.y, z: src.z, visibility: src.visibility };
      });

    // Right-handed pro forehand: right wrist & elbow swing through an arc.
    const proFrames = Array.from({ length: 12 }, (_, i) => {
      const f = defaultFrame();
      f[L.RIGHT_WRIST] = { x: 0.1 + i * 0.05, y: 1.0 + i * 0.04, z: 0, visibility: 1 };
      f[L.RIGHT_ELBOW] = { x: 0.25, y: 1.1 + i * 0.01, z: 0, visibility: 1 };
      return f;
    });
    // Left-handed user performs the exact mirror image of the pro.
    const userFrames = proFrames.map(mirrorFrame);

    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: proFrames, fps: 30, kind: "video" },
      user: { frames: userFrames, fps: 30 },
    });

    expect(report.handedness).toEqual({ pro: "right", user: "left", mirrored: true });
    // Mirrored comparison should see the two motions as essentially identical.
    expect(report.overallSimilarity).toBeGreaterThan(0.9);
    const elbow = report.jointDeltas.find((d) => d.joint === "right_elbow");
    expect(elbow!.meanDeltaDeg).toBeLessThan(2);
  });

  it("repairImplausibleFrames interpolates depth-flipped (inverted-torso) frames", () => {
    const F = JOINT_FEATURES.length;
    const TL = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const good = () => new Array<number>(F).fill(10);
    const seq = [good(), good(), good(), good(), good()];
    // Frame 2 is a MediaPipe depth-flip: torso reads inverted and every feature
    // is garbage on that frame.
    seq[2] = new Array<number>(F).fill(99);
    seq[2][TL] = 160;
    const out = repairImplausibleFrames(seq);
    expect(out[2][TL]).toBeCloseTo(10, 5); // interpolated from valid neighbours
    expect(out[2][0]).toBeCloseTo(10, 5); // whole vector repaired, not just trunk_lean
    expect(out[0][TL]).toBe(10); // clean frames untouched
    expect(out[4][TL]).toBe(10);
  });

  it("significance is driven by systematic bias, not noisy mean-abs delta", () => {
    // Pro holds the right elbow steady at 90°. The user is ≈105° for the first
    // half and ≈75° for the second half, so the average ABSOLUTE per-frame gap is
    // large (~15°) but the SIGNED bias cancels to ~0 — there is no consistent
    // technique offset to coach, so significance must read low.
    const elbowFrame = (wrist: [number, number, number]): PoseFrame => {
      const f = defaultFrame();
      f[L.RIGHT_SHOULDER] = { x: 0, y: 1, z: 0, visibility: 1 };
      f[L.RIGHT_ELBOW] = { x: 1, y: 1, z: 0, visibility: 1 };
      f[L.RIGHT_WRIST] = { x: wrist[0], y: wrist[1], z: wrist[2], visibility: 1 };
      return f;
    };
    const pro = Array.from({ length: 16 }, () => elbowFrame([1, 2, 0])); // 90°
    // Low-frequency excursion (first half ≈105°, second half ≈75°) so the
    // temporal smoothing filter doesn't just cancel it: net bias ≈ 0, but a real
    // average absolute gap of ~15°.
    const user = Array.from({ length: 16 }, (_, i) =>
      i < 8 ? elbowFrame([0.741, 1.966, 0]) : elbowFrame([1.259, 1.966, 0]),
    );
    const report = compare({
      sport: SPORT,
      shot: "Forehand",
      pro: { frames: pro, fps: 30, kind: "video" },
      user: { frames: user, fps: 30 },
    });
    const elbow = report.jointDeltas.find((d) => d.joint === "right_elbow")!;
    expect(elbow.meanDeltaDeg).toBeGreaterThan(7); // sizeable frame-to-frame variation
    expect(Math.abs(elbow.signedBiasDeg)).toBeLessThan(5); // but no systematic offset
    expect(elbow.significance).toBe("low"); // → not flagged as a fault
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
