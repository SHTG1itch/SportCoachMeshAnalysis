import { describe, expect, it } from "vitest";
import {
  computeAngles,
  computeAnglesSequence,
  detectUpSign,
  featureConfidence,
  FEATURE_LANDMARKS,
  JOINT_FEATURES,
} from "./angles";
import { L, type PoseFrame } from "./types";

function mkFrame(overrides: Partial<Record<number, [number, number, number]>>): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) {
    f.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  for (const [idxStr, coords] of Object.entries(overrides)) {
    if (!coords) continue;
    const idx = Number(idxStr);
    f[idx] = { x: coords[0], y: coords[1], z: coords[2], visibility: 1 };
  }
  return f;
}

describe("computeAngles", () => {
  it("returns one value per feature", () => {
    const f = mkFrame({});
    const out = computeAngles(f);
    expect(out).toHaveLength(JOINT_FEATURES.length);
  });

  it("right elbow fully extended (straight line) = 0° flexion", () => {
    // Arrange shoulder, elbow, wrist colinear on +x axis.
    const f = mkFrame({
      [L.RIGHT_SHOULDER]: [0, 1, 0],
      [L.RIGHT_ELBOW]: [1, 1, 0],
      [L.RIGHT_WRIST]: [2, 1, 0],
      [L.LEFT_SHOULDER]: [0, 1, 0.1],
      [L.LEFT_HIP]: [0, 0, 0.1],
      [L.RIGHT_HIP]: [0, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_elbow");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("right elbow at 90°: upper arm on +x, forearm on +y", () => {
    const f = mkFrame({
      [L.RIGHT_SHOULDER]: [0, 1, 0],
      [L.RIGHT_ELBOW]: [1, 1, 0],
      [L.RIGHT_WRIST]: [1, 2, 0],
      [L.LEFT_SHOULDER]: [0, 1, 0.1],
      [L.LEFT_HIP]: [0, 0, 0.1],
      [L.RIGHT_HIP]: [0, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_elbow");
    expect(out[idx]).toBeCloseTo(90, 3);
  });

  it("knee straight = 0° flexion", () => {
    const f = mkFrame({
      [L.LEFT_HIP]: [0, 1, 0],
      [L.LEFT_KNEE]: [0, 0.5, 0],
      [L.LEFT_ANKLE]: [0, 0, 0],
      [L.LEFT_SHOULDER]: [0, 2, 0],
      [L.RIGHT_SHOULDER]: [0.3, 2, 0],
      [L.RIGHT_HIP]: [0.3, 1, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "left_knee");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  // Direction-pinning tests: these fix the PHYSICAL convention of each metric,
  // not just its magnitude. The shoulder and ankle conventions were once
  // inverted relative to their labels — the coaching copy then described both
  // faults exactly backwards, and no test caught it because none pinned which
  // way the number grows.
  it("shoulder abduction GROWS as the arm moves away from the torso", () => {
    const base = {
      [L.RIGHT_HIP]: [0, 0, 0] as [number, number, number],
      [L.LEFT_HIP]: [-0.3, 0, 0] as [number, number, number],
      [L.RIGHT_SHOULDER]: [0, 1, 0] as [number, number, number],
      [L.LEFT_SHOULDER]: [-0.3, 1, 0] as [number, number, number],
    };
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_shoulder");
    // Arm hanging straight down at the side (elbow below shoulder).
    const atSide = computeAngles(mkFrame({ ...base, [L.RIGHT_ELBOW]: [0, 0.6, 0] }));
    // Arm raised horizontally.
    const horizontal = computeAngles(mkFrame({ ...base, [L.RIGHT_ELBOW]: [0.4, 1, 0] }));
    // Arm overhead.
    const overhead = computeAngles(mkFrame({ ...base, [L.RIGHT_ELBOW]: [0, 1.4, 0] }));
    expect(atSide[idx]).toBeCloseTo(0, 3);
    expect(horizontal[idx]).toBeCloseTo(90, 3);
    expect(overhead[idx]).toBeCloseTo(180, 3);
  });

  it("ankle dorsiflexion GROWS as the shin closes over the toes", () => {
    const base = {
      [L.RIGHT_ANKLE]: [0, 0, 0] as [number, number, number],
      [L.RIGHT_FOOT_INDEX]: [0.3, 0, 0] as [number, number, number],
    };
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_ankle");
    // Neutral: shin vertical over the ankle, foot flat forward.
    const neutral = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [0, 1, 0] }));
    // Dorsiflexed: knee travels forward over the toes.
    const dorsi = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [0.5, 0.87, 0] }));
    // Plantarflexed: shin behind the ankle (pointed toes).
    const plantar = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [-0.5, 0.87, 0] }));
    expect(neutral[idx]).toBeCloseTo(90, 3);
    expect(dorsi[idx]).toBeGreaterThan(neutral[idx]);
    expect(plantar[idx]).toBeLessThan(neutral[idx]);
  });

  it("hip flexion GROWS as the hips fold (0 = standing tall)", () => {
    // Pins the physical convention: the doc comment above hipFlex was once
    // inverted, and an edit "fixing" the code to match it would flip every
    // piece of hip coaching ("stand taller" vs "hinge deeper") with no test
    // failing. Same trap that actually bit shoulder and ankle.
    const base = {
      [L.RIGHT_SHOULDER]: [0, 2, 0] as [number, number, number],
      [L.RIGHT_HIP]: [0, 1, 0] as [number, number, number],
      [L.LEFT_SHOULDER]: [-0.3, 2, 0] as [number, number, number],
      [L.LEFT_HIP]: [-0.3, 1, 0] as [number, number, number],
    };
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_hip");
    // Standing: knee directly below the hip, thigh extending the torso line.
    const standing = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [0, 0.5, 0] }));
    // Hinged ~90°: thigh horizontal.
    const hinged = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [0.5, 1, 0] }));
    // Knee to chest: thigh parallel to the torso axis.
    const folded = computeAngles(mkFrame({ ...base, [L.RIGHT_KNEE]: [0, 1.5, 0.01] }));
    expect(standing[idx]).toBeCloseTo(0, 3);
    expect(hinged[idx]).toBeCloseTo(90, 3);
    expect(folded[idx]).toBeGreaterThan(170);
  });

  it("trunk rotation is zeroed AND de-confidenced when the horizontal projection degenerates", () => {
    // Torso pitched ~90° (prone/dive): the shoulder line is near-vertical, so
    // its horizontal projection is detector-noise residue. Without the gate the
    // "rotation" between two noise vectors is a random 0–180° at FULL landmark
    // visibility — systematic within a phase, so it survives the trimmed mean.
    const f = mkFrame({
      // Shoulder line runs almost straight down (+ tiny noise-scale x/z residue).
      [L.LEFT_SHOULDER]: [0.02, 2, -0.01],
      [L.RIGHT_SHOULDER]: [-0.01, 1, 0.02],
      // Hip line stays horizontal.
      [L.LEFT_HIP]: [-0.3, 1.5, 0],
      [L.RIGHT_HIP]: [0.3, 1.5, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    expect(computeAngles(f)[idx]).toBe(0);
    expect(featureConfidence(f)[idx]).toBe(0);
    // A normal upright pose is untouched by the gate.
    const upright = mkFrame({
      [L.LEFT_SHOULDER]: [-0.3, 2, 0],
      [L.RIGHT_SHOULDER]: [0.3, 2, 0.3],
      [L.LEFT_HIP]: [-0.3, 1, 0],
      [L.RIGHT_HIP]: [0.3, 1, 0],
    });
    expect(computeAngles(upright)[idx]).toBeGreaterThan(1);
    expect(featureConfidence(upright)[idx]).toBe(1);
  });

  it("trunk lean is zeroed AND de-confidenced when the hip line degenerates to vertical", () => {
    // Rolled/inverted pose: the hip line runs nearly straight down, so the
    // body-relative "front" (up × hipLine) that signs the lean is a noise-scale
    // vector. A ±2 cm residue then flips a ~90° lean's sign at full landmark
    // visibility — and a ±90° swing stays under the repair threshold, so
    // nothing downstream catches it.
    const mk = (residue: number) =>
      mkFrame({
        [L.LEFT_HIP]: [0, 1, 0],
        [L.RIGHT_HIP]: [residue, 0, residue],
        // Torso axis horizontal (shoulders out along x from the hip midpoint).
        [L.LEFT_SHOULDER]: [1, 0.5, -0.15],
        [L.RIGHT_SHOULDER]: [1, 0.5, 0.15],
      });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    for (const r of [0.02, -0.02]) {
      expect(computeAngles(mk(r))[idx]).toBe(0);
      expect(featureConfidence(mk(r))[idx]).toBe(0);
    }
    // A normal upright pose is untouched by the gate.
    const upright = mkFrame({
      [L.LEFT_SHOULDER]: [-0.3, 2, 0],
      [L.RIGHT_SHOULDER]: [0.3, 2, 0],
      [L.LEFT_HIP]: [-0.3, 1, 0],
      [L.RIGHT_HIP]: [0.3, 1, 0],
    });
    expect(featureConfidence(upright)[idx]).toBe(1);
  });

  it("featureConfidence gates geometry on the cleaned frame when one is provided", () => {
    // Value gates run on CLEANED frames, so the confidence gate must judge the
    // same geometry: a raw frame whose projection ratio sits just above the
    // threshold while smoothing drags the cleaned ratio below it would
    // otherwise emit a hard-zeroed angle at full confidence.
    const rawOk = mkFrame({
      [L.LEFT_SHOULDER]: [-0.3, 2, 0],
      [L.RIGHT_SHOULDER]: [0.3, 2, 0],
      [L.LEFT_HIP]: [-0.3, 1, 0],
      [L.RIGHT_HIP]: [0.3, 1, 0],
    });
    const cleanedDegenerate = mkFrame({
      [L.LEFT_SHOULDER]: [0.02, 2, -0.01],
      [L.RIGHT_SHOULDER]: [-0.01, 1, 0.02],
      [L.LEFT_HIP]: [-0.3, 1.5, 0],
      [L.RIGHT_HIP]: [0.3, 1.5, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    // Same frame for both → no gate.
    expect(featureConfidence(rawOk)[idx]).toBe(1);
    // Cleaned geometry degenerate → gate fires even though raw looks fine.
    expect(featureConfidence(rawOk, cleanedDegenerate)[idx]).toBe(0);
  });

  it("trunk rotation ~ 0 when shoulders parallel to hips", () => {
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-1, 2, 0],
      [L.RIGHT_SHOULDER]: [1, 2, 0],
      [L.LEFT_HIP]: [-1, 0, 0],
      [L.RIGHT_HIP]: [1, 0, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("trunk lean = 0 when torso is vertical", () => {
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    expect(out[idx]).toBeCloseTo(0, 3);
  });

  it("trunk lean is SIGNED: +45° leaning forward, -45° leaning backward", () => {
    // This fixture's athlete has the right hip at +x with up +y, so their
    // anatomical front is -z (front = up x right). Shoulders pushed to -z is a
    // forward lean; +z is backward. The sign distinguishes a reverse-spine
    // fault from the pro's forward hinge — unsigned lean scored them identical.
    const lean = (z: number) =>
      mkFrame({
        [L.LEFT_SHOULDER]: [-0.2, 2, z],
        [L.RIGHT_SHOULDER]: [0.2, 2, z],
        [L.LEFT_HIP]: [-0.2, 1, 0],
        [L.RIGHT_HIP]: [0.2, 1, 0],
      });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    expect(computeAngles(lean(-1))[idx]).toBeCloseTo(45, 3); // forward
    expect(computeAngles(lean(1))[idx]).toBeCloseTo(-45, 3); // backward
  });

  it("trunk lean is invariant to camera yaw (rotation about vertical)", () => {
    const base = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0.7],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0.7],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const leanBase = computeAngles(base)[idx];
    // Rotate the whole pose 50° about the vertical (y) axis — a pure change of
    // camera facing. Trunk lean (measured against gravity) must not move.
    const theta = (50 * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rotated: PoseFrame = base.map((p) => ({
      x: p.x * cos + p.z * sin,
      y: p.y,
      z: -p.x * sin + p.z * cos,
      visibility: p.visibility,
    }));
    const leanRot = computeAngles(rotated)[idx];
    expect(leanRot).toBeCloseTo(leanBase, 3);
  });

  it("detectUpSign: -1 for y-down (MediaPipe) world coords, +1 for y-up", () => {
    // y-DOWN: shoulders physically above hips => smaller (more negative) y.
    const down = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, -0.5, 0],
      [L.RIGHT_SHOULDER]: [0.2, -0.5, 0],
      [L.LEFT_HIP]: [-0.2, 0, 0],
      [L.RIGHT_HIP]: [0.2, 0, 0],
    });
    expect(detectUpSign([down, down, down])).toBe(-1);
    const up = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, 2, 0],
      [L.RIGHT_SHOULDER]: [0.2, 2, 0],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.2, 1, 0],
    });
    expect(detectUpSign([up, up, up])).toBe(1);
  });

  it("trunk lean reads ~upright for y-DOWN data via computeAnglesSequence", () => {
    // Near-upright torso with a slight forward (+z) lean, in MediaPipe's y-DOWN
    // world frame (shoulders above hips => negative y).
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.2, -1, 0.1],
      [L.RIGHT_SHOULDER]: [0.2, -1, 0.1],
      [L.LEFT_HIP]: [-0.2, 0, 0],
      [L.RIGHT_HIP]: [0.2, 0, 0],
    });
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const seq = computeAnglesSequence([f, f, f]);
    expect(Math.abs(seq[0][idx])).toBeLessThan(20); // small lean — NOT the ~180° sign-flip
    // The per-frame default (upSign = +1) would mis-read the same data as inverted.
    expect(Math.abs(computeAngles(f)[idx])).toBeGreaterThan(150);
  });

  it("signed trunk lean survives the pipeline's mirror transform (negate x + L/R swap)", () => {
    // handedness.ts treats trunk features as mirror-invariant (no column sign
    // flip). That only holds if the sagittal sign is body-relative: mirroring a
    // forward-leaning athlete must still read forward.
    const f = mkFrame({
      [L.LEFT_SHOULDER]: [-0.25, 2, -0.6],
      [L.RIGHT_SHOULDER]: [0.2, 2.1, -0.7],
      [L.LEFT_HIP]: [-0.2, 1, 0],
      [L.RIGHT_HIP]: [0.15, 1.05, 0.05],
    });
    const swap: [number, number][] = [
      [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
      [L.LEFT_HIP, L.RIGHT_HIP],
    ];
    const mirrored: PoseFrame = f.map((p) => ({ ...p, x: -p.x }));
    for (const [a, b] of swap) {
      const tmp = mirrored[a];
      mirrored[a] = mirrored[b];
      mirrored[b] = tmp;
    }
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_lean");
    const orig = computeAngles(f)[idx];
    expect(Math.abs(orig)).toBeGreaterThan(10); // fixture genuinely leans
    expect(computeAngles(mirrored)[idx]).toBeCloseTo(orig, 6);
  });

  it("trunk rotation ~ 90° when shoulders rotated 90° to hips", () => {
    const f = mkFrame({
      // hips along x axis
      [L.LEFT_HIP]: [-1, 0, 0],
      [L.RIGHT_HIP]: [1, 0, 0],
      // shoulders along z axis (projected horizontal)
      [L.LEFT_SHOULDER]: [0, 2, -1],
      [L.RIGHT_SHOULDER]: [0, 2, 1],
    });
    const out = computeAngles(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "trunk_rotation");
    expect(out[idx]).toBeCloseTo(90, 3);
  });

  it("gates trunk features at the shared VIS_THRESHOLD (0.3), not the old 0.4 drift band", () => {
    // A core landmark interpolated to ~0.35 visibility is "usable" everywhere
    // else in the pipeline (fillGaps anchors at >= 0.3). The angle gate must
    // agree, or it injects a spurious hard 0° into the unweighted DTW/similarity
    // path for the smallest-scale trunk features.
    const make = (vis: number) => {
      const f = mkFrame({
        [L.LEFT_SHOULDER]: [0.2, 1, 0],
        [L.RIGHT_SHOULDER]: [0.4, 1.1, 0],
        [L.LEFT_HIP]: [0, 0, 0],
        [L.RIGHT_HIP]: [0.1, 0, 0],
      });
      for (const i of [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP]) {
        f[i].visibility = vis;
      }
      return f;
    };
    const fi = (n: string) => JOINT_FEATURES.findIndex((j) => j.name === n);
    const trunk = [fi("trunk_rotation"), fi("trunk_lean"), fi("shoulder_line_tilt")];

    const full = computeAngles(make(1));
    expect(trunk.some((i) => Math.abs(full[i]) > 1)).toBe(true); // pose has real trunk geometry

    // 0.35 >= 0.3 usable bar: trunk features preserved (the old 0.4 gate wrongly zeroed them).
    const usable = computeAngles(make(0.35));
    for (const i of trunk) expect(usable[i]).toBeCloseTo(full[i], 6);

    // Below the usable bar they are still gated to 0.
    const gated = computeAngles(make(0.2));
    for (const i of trunk) expect(gated[i]).toBe(0);
  });
});

describe("featureConfidence", () => {
  // Real torso geometry: the all-zero mkFrame default has zero-length shoulder
  // and hip lines, which the trunk_rotation projection gate rightly treats as
  // unmeasurable — confidence fixtures must be geometrically valid poses.
  const TORSO = {
    [L.LEFT_SHOULDER]: [-0.3, 2, 0] as [number, number, number],
    [L.RIGHT_SHOULDER]: [0.3, 2, 0] as [number, number, number],
    [L.LEFT_HIP]: [-0.3, 1, 0] as [number, number, number],
    [L.RIGHT_HIP]: [0.3, 1, 0] as [number, number, number],
  };

  it("returns one confidence per feature, 1.0 when everything is visible", () => {
    const f = mkFrame(TORSO);
    const c = featureConfidence(f);
    expect(c).toHaveLength(JOINT_FEATURES.length);
    expect(FEATURE_LANDMARKS).toHaveLength(JOINT_FEATURES.length);
    for (const v of c) expect(v).toBe(1);
  });

  it("a feature's confidence is the MIN visibility of its input landmarks", () => {
    const f = mkFrame({});
    f[L.RIGHT_WRIST].visibility = 0.2; // feeds right_elbow only
    f[L.RIGHT_ELBOW].visibility = 0.6; // feeds right_elbow + right_shoulder
    const c = featureConfidence(f);
    const idx = (n: string) => JOINT_FEATURES.findIndex((j) => j.name === n);
    expect(c[idx("right_elbow")]).toBeCloseTo(0.2, 6); // min(shoulder=1, elbow=0.6, wrist=0.2)
    expect(c[idx("right_shoulder")]).toBeCloseTo(0.6, 6); // min(shoulder=1, hip=1, elbow=0.6)
    expect(c[idx("left_elbow")]).toBe(1); // other side untouched
  });

  it("trunk features are gated by ALL FOUR core landmarks (matching the angle zeroing)", () => {
    // computeAngles zeroes trunk_rotation/lean/shoulder_line_tilt when ANY core
    // landmark is below its visibility gate, so a bad hip must lower the
    // confidence of shoulder_line_tilt too even though its geometry only uses
    // the shoulders — otherwise the gated 0 reads as a trustworthy angle.
    const f = mkFrame(TORSO);
    f[L.LEFT_HIP].visibility = 0.1;
    const c = featureConfidence(f);
    const idx = (n: string) => JOINT_FEATURES.findIndex((j) => j.name === n);
    expect(c[idx("trunk_rotation")]).toBeCloseTo(0.1, 6);
    expect(c[idx("trunk_lean")]).toBeCloseTo(0.1, 6);
    expect(c[idx("shoulder_line_tilt")]).toBeCloseTo(0.1, 6);
  });

  it("clamps out-of-range visibility into 0..1", () => {
    const f = mkFrame({});
    f[L.RIGHT_WRIST].visibility = -0.5;
    const c = featureConfidence(f);
    const idx = JOINT_FEATURES.findIndex((j) => j.name === "right_elbow");
    expect(c[idx]).toBe(0);
  });
});
