import { describe, expect, it } from "vitest";
import {
  fillGaps,
  despikeFrames,
  smoothFrames,
  detectionCoverage,
  VIS_THRESHOLD,
} from "./prepare";
import { L, type PoseFrame } from "./types";
import { computeAngles } from "./angles";

function standingFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 1 });
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

function emptyFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 0 });
  return f;
}

describe("fillGaps", () => {
  it("replaces an all-zero dropout frame with interpolated neighbours", () => {
    const a = standingFrame();
    const c = standingFrame();
    // Shift the third frame's right wrist so interpolation has a clear target.
    c[L.RIGHT_WRIST] = { x: 0.5, y: 1.2, z: 0.1, visibility: 1 };
    const frames = [a, emptyFrame(), c];

    const filled = fillGaps(frames);
    const wrist = filled[1][L.RIGHT_WRIST];
    // Midpoint of a (0.35,0.85,0) and c (0.5,1.2,0.1).
    expect(wrist.x).toBeCloseTo(0.425, 5);
    expect(wrist.y).toBeCloseTo(1.025, 5);
    expect(wrist.z).toBeCloseTo(0.05, 5);
    expect(wrist.visibility).toBeGreaterThanOrEqual(VIS_THRESHOLD);
  });

  it("eliminates the spurious 180° straight-limb angles a zero frame would create", () => {
    const frames = [standingFrame(), emptyFrame(), standingFrame()];
    // Without repair, the middle frame's elbow reads ~180°.
    const rawMidElbow = computeAngles(frames[1])[0];
    expect(rawMidElbow).toBeCloseTo(180, 0);

    const filled = fillGaps(frames);
    const fixedMidElbow = computeAngles(filled[1])[0];
    const goodElbow = computeAngles(standingFrame())[0];
    expect(fixedMidElbow).toBeCloseTo(goodElbow, 3);
  });

  it("holds the nearest anchor over leading and trailing gaps (no extrapolation)", () => {
    const mid = standingFrame();
    mid[L.RIGHT_WRIST] = { x: 0.9, y: 1.0, z: 0, visibility: 1 };
    const frames = [emptyFrame(), mid, emptyFrame()];

    const filled = fillGaps(frames);
    // Leading and trailing frames copy the only anchor exactly.
    expect(filled[0][L.RIGHT_WRIST].x).toBeCloseTo(0.9, 6);
    expect(filled[2][L.RIGHT_WRIST].x).toBeCloseTo(0.9, 6);
  });

  it("leaves a never-detected landmark untouched and does not mutate input", () => {
    const frames = [emptyFrame(), emptyFrame()];
    const filled = fillGaps(frames);
    expect(filled[0][L.RIGHT_WRIST].visibility).toBe(0);
    // Original frames are not mutated.
    expect(frames[0]).not.toBe(filled[0]);
  });

  it("does not alter already-clean frames", () => {
    const frames = [standingFrame(), standingFrame()];
    const filled = fillGaps(frames);
    for (let i = 0; i < frames.length; i++) {
      for (let j = 0; j < 33; j++) {
        expect(filled[i][j].x).toBeCloseTo(frames[i][j].x, 9);
        expect(filled[i][j].y).toBeCloseTo(frames[i][j].y, 9);
        expect(filled[i][j].z).toBeCloseTo(frames[i][j].z, 9);
      }
    }
  });
});

describe("smoothFrames", () => {
  // Build a sequence where one landmark follows a smooth path plus alternating
  // jitter, so we can check the filter attenuates the jitter.
  function jitterSeq(): PoseFrame[] {
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 9; i++) {
      const f = standingFrame();
      const jitter = i % 2 === 0 ? 0.1 : -0.1;
      f[L.RIGHT_WRIST] = { x: 0.35 + jitter, y: 0.85, z: 0, visibility: 1 };
      frames.push(f);
    }
    return frames;
  }

  it("attenuates frame-to-frame jitter on a noisy landmark", () => {
    const frames = jitterSeq();
    const smoothed = smoothFrames(frames, 1);
    // Interior frames should land near the true center (0.35), not at ±0.1.
    for (let i = 1; i < frames.length - 1; i++) {
      const x = smoothed[i][L.RIGHT_WRIST].x;
      expect(Math.abs(x - 0.35)).toBeLessThan(0.06);
    }
  });

  it("preserves the location of a genuine velocity peak", () => {
    // Right wrist accelerates to a clear speed peak at frame 5, then decelerates.
    const path = [0, 0.02, 0.06, 0.14, 0.3, 0.6, 0.78, 0.86, 0.9, 0.92];
    const frames = path.map((px) => {
      const f = standingFrame();
      f[L.RIGHT_WRIST] = { x: px, y: 0.85, z: 0, visibility: 1 };
      return f;
    });
    const speedPeak = (fs: PoseFrame[]): number => {
      let peak = 0;
      let best = -1;
      for (let i = 1; i < fs.length; i++) {
        const s = Math.abs(fs[i][L.RIGHT_WRIST].x - fs[i - 1][L.RIGHT_WRIST].x);
        if (s > best) {
          best = s;
          peak = i;
        }
      }
      return peak;
    };
    expect(speedPeak(smoothFrames(frames, 1))).toBe(speedPeak(frames));
  });

  it("does not mutate input and carries visibility through unchanged", () => {
    const frames = jitterSeq();
    const smoothed = smoothFrames(frames, 1);
    expect(smoothed[0]).not.toBe(frames[0]);
    expect(smoothed[3][L.RIGHT_WRIST].visibility).toBe(1);
  });

  it("is a no-op for a single frame", () => {
    const f = standingFrame();
    const smoothed = smoothFrames([f], 1);
    expect(smoothed[0][L.RIGHT_WRIST].x).toBeCloseTo(f[L.RIGHT_WRIST].x, 9);
  });
});

describe("despikeFrames", () => {
  // A still stance with one landmark teleporting away and back — the
  // high-confidence detector glitch despikeFrames exists to repair.
  function spikeSeq(spikeAt: number[], n = 12): PoseFrame[] {
    const frames: PoseFrame[] = [];
    for (let i = 0; i < n; i++) {
      const f = standingFrame();
      if (spikeAt.includes(i)) {
        f[L.RIGHT_SHOULDER] = { x: 1.2, y: 0.4, z: 0.5, visibility: 1 };
      }
      frames.push(f);
    }
    return frames;
  }

  it("repairs a single-frame teleport back to the stable position", () => {
    const fixed = despikeFrames(spikeSeq([5]));
    const sh = fixed[5][L.RIGHT_SHOULDER];
    expect(sh.x).toBeCloseTo(0.2, 6);
    expect(sh.y).toBeCloseTo(1.4, 6);
    expect(sh.z).toBeCloseTo(0, 6);
  });

  it("repairs a two-frame glitch run", () => {
    const fixed = despikeFrames(spikeSeq([5, 6]));
    for (const i of [5, 6]) {
      expect(fixed[i][L.RIGHT_SHOULDER].x).toBeCloseTo(0.2, 6);
      expect(fixed[i][L.RIGHT_SHOULDER].y).toBeCloseTo(1.4, 6);
    }
  });

  it("leaves visibility untouched so downstream weighting stays honest", () => {
    const frames = spikeSeq([5]);
    frames[5][L.RIGHT_SHOULDER].visibility = 0.97;
    const fixed = despikeFrames(frames);
    expect(fixed[5][L.RIGHT_SHOULDER].visibility).toBe(0.97);
  });

  it("does not clip genuinely fast smooth motion", () => {
    // Wrist sweeping 0.25 m per frame in one direction — much farther per frame
    // than the spike floor, but smooth, so neighbours spread raises the bar.
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 12; i++) {
      const f = standingFrame();
      f[L.RIGHT_WRIST] = { x: 0.35 + 0.25 * i, y: 0.85, z: 0, visibility: 1 };
      frames.push(f);
    }
    const fixed = despikeFrames(frames);
    for (let i = 0; i < frames.length; i++) {
      expect(fixed[i][L.RIGHT_WRIST].x).toBeCloseTo(frames[i][L.RIGHT_WRIST].x, 6);
    }
  });

  it("does not flag a sharp but physically plausible direction reversal", () => {
    // Out-and-back path with 0.08 m deviation at the apex — under the floor.
    const xs = [0.35, 0.39, 0.43, 0.47, 0.43, 0.39, 0.35, 0.35, 0.35, 0.35];
    const frames = xs.map((x) => {
      const f = standingFrame();
      f[L.RIGHT_WRIST] = { x, y: 0.85, z: 0, visibility: 1 };
      return f;
    });
    const fixed = despikeFrames(frames);
    for (let i = 0; i < frames.length; i++) {
      expect(fixed[i][L.RIGHT_WRIST].x).toBeCloseTo(frames[i][L.RIGHT_WRIST].x, 6);
    }
  });

  it("is a no-op for clips too short to judge and does not mutate input", () => {
    const frames = spikeSeq([1], 3);
    const fixed = despikeFrames(frames);
    expect(fixed[1][L.RIGHT_SHOULDER].x).toBeCloseTo(1.2, 6);
    expect(fixed[0]).not.toBe(frames[0]);
  });

  it("holds the nearest good frame across a glitch at the clip edge", () => {
    const fixed = despikeFrames(spikeSeq([0]));
    expect(fixed[0][L.RIGHT_SHOULDER].x).toBeCloseTo(0.2, 6);
  });
});

describe("detectionCoverage", () => {
  const core = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
  it("is 1 for fully detected clips and 0 for fully missing clips", () => {
    expect(detectionCoverage([standingFrame(), standingFrame()], core)).toBe(1);
    expect(detectionCoverage([emptyFrame(), emptyFrame()], core)).toBe(0);
  });
  it("reports the fraction of detected frames", () => {
    const frames = [standingFrame(), emptyFrame(), standingFrame(), emptyFrame()];
    expect(detectionCoverage(frames, core)).toBeCloseTo(0.5, 6);
  });
});
