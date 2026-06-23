// Real-footage, multi-sport regression test.
//
// These fixtures are pose landmarks MediaPipe actually extracted from real,
// freely-licensed sport clips (Wikimedia Commons): a basketball free throw
// (pro vs amateur), a soccer penalty kick, and boxing training. They were
// captured by running the live extractor in Electron and persisted as compact
// JSON in harness-results/. Unlike the synthetic multisport.test.ts, this proves
// the compare()+coach pipeline behaves on REAL detector output (noise, dropouts,
// real biomechanics) across sports and BOTH key-joint types (wrist + ankle) —
// runnable in plain Node with no MediaPipe/browser/network.
//
// Runs by default when the fixtures are present; skips gracefully otherwise.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./compare";
import { generateGuideAndWorkouts } from "../coach";
import { L, type PoseFrame } from "./types";
import type { AnalysisReport, SportMeta } from "@shared/types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
function load(name: string): PoseFrame[] | null {
  const p = path.join(RESULTS, `frames_${name}.txt`);
  if (!fs.existsSync(p)) return null;
  try {
    return (JSON.parse(fs.readFileSync(p, "utf8")).frames as PoseFrame[]) ?? null;
  } catch {
    return null;
  }
}
const clone = (fr: PoseFrame[]): PoseFrame[] => fr.map((f) => f.map((l) => ({ ...l })));

// Geometric sagittal mirror: negate x and swap L/R landmark indices.
const MIRROR_PAIRS: [number, number][] = [
  [L.LEFT_SHOULDER, L.RIGHT_SHOULDER], [L.LEFT_ELBOW, L.RIGHT_ELBOW],
  [L.LEFT_WRIST, L.RIGHT_WRIST], [L.LEFT_HIP, L.RIGHT_HIP],
  [L.LEFT_KNEE, L.RIGHT_KNEE], [L.LEFT_ANKLE, L.RIGHT_ANKLE],
  [L.LEFT_HEEL, L.RIGHT_HEEL], [L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX],
  [L.LEFT_EYE, L.RIGHT_EYE], [L.LEFT_EAR, L.RIGHT_EAR],
];
function mirror(frames: PoseFrame[]): PoseFrame[] {
  const partner = new Map<number, number>();
  for (const [a, b] of MIRROR_PAIRS) {
    partner.set(a, b);
    partner.set(b, a);
  }
  return frames.map((f) => f.map((_, i) => {
    const s = f[partner.get(i) ?? i];
    return { x: -s.x, y: s.y, z: s.z, visibility: s.visibility };
  }));
}

const sport = (id: string, keyJoint: SportMeta["keyJoint"]): SportMeta => ({
  id: id as SportMeta["id"], name: id, shots: ["Shot"], keyJoint, description: "",
});

function cmp(s: SportMeta, pro: PoseFrame[], user: PoseFrame[]): AnalysisReport {
  return compare({ sport: s, shot: "Shot", pro: { frames: pro, fps: 30, kind: "video" }, user: { frames: user, fps: 30 } });
}
function assertFinite(r: AnalysisReport): void {
  expect(Number.isFinite(r.overallSimilarity)).toBe(true);
  expect(r.overallSimilarity).toBeGreaterThanOrEqual(0);
  expect(r.overallSimilarity).toBeLessThanOrEqual(1);
  for (const d of r.jointDeltas) {
    for (const k of ["meanDeltaDeg", "maxDeltaDeg", "proMeanDeg", "userMeanDeg", "signedBiasDeg"] as const) {
      expect(Number.isFinite(d[k]), `${d.joint}.${k}`).toBe(true);
    }
  }
}

const boxing = load("boxing");
const soccer = load("soccer");
const bballPro = load("bball_pro");
const bballAm = load("bball_am");
const have = !!(boxing && soccer && bballPro && bballAm);

describe("real-footage multi-sport pipeline", () => {
  it.skipIf(!have)("self-consistency holds on real boxing footage (≈100%)", () => {
    const r = cmp(sport("boxing", "right_wrist"), boxing!, clone(boxing!));
    assertFinite(r);
    expect(r.overallSimilarity).toBeGreaterThanOrEqual(0.98);
  });

  it.skipIf(!have)("mirror-consistency holds on real boxing footage (≈100%, mirrored)", () => {
    const r = cmp(sport("boxing", "right_wrist"), boxing!, mirror(boxing!));
    assertFinite(r);
    expect(r.handedness!.mirrored).toBe(true);
    expect(r.overallSimilarity).toBeGreaterThanOrEqual(0.9);
  });

  it.skipIf(!have)("self-consistency holds on real soccer footage — the ankle key-joint path", () => {
    const r = cmp(sport("soccer", "right_ankle"), soccer!, clone(soccer!));
    assertFinite(r);
    expect(r.overallSimilarity).toBeGreaterThanOrEqual(0.98);
    expect(r.phases.length).toBeGreaterThan(0);
  });

  it.skipIf(!have)("mirror-consistency holds on real soccer footage (ankle handedness mirror)", () => {
    const r = cmp(sport("soccer", "right_ankle"), soccer!, mirror(soccer!));
    assertFinite(r);
    expect(r.handedness!.mirrored).toBe(true);
    expect(r.overallSimilarity).toBeGreaterThanOrEqual(0.9);
  });

  it.skipIf(!have)("produces a sane, non-contradictory report + coaching for a real pro-vs-amateur free throw", () => {
    const r = cmp(sport("basketball", "right_wrist"), bballPro!, bballAm!);
    assertFinite(r);
    // A genuine technique gap: clearly different, but recognizably the same motion.
    expect(r.overallSimilarity).toBeGreaterThan(0.2);
    expect(r.overallSimilarity).toBeLessThan(0.95);
    const { guide, workouts } = generateGuideAndWorkouts({
      sport: sport("basketball", "right_wrist"),
      shot: "Free throw",
      numericReport: {
        overallSimilarity: r.overallSimilarity,
        jointDeltas: r.jointDeltas,
        phases: r.phases,
        mode: r.mode,
        handedness: r.handedness,
      },
    });
    expect(guide.keyIssues.length).toBeGreaterThan(0);
    expect(workouts.length).toBe(3);
    // Every flagged issue is direction-aware and grounded in real numbers.
    for (const k of guide.keyIssues) {
      expect(k.fix.toLowerCase()).toContain("match the pro");
      expect((k.muscles ?? []).length).toBeGreaterThan(0);
    }
    // (The no-contradiction invariant is rigorously covered in coach.test.ts and
    // multisport.test.ts with exact group logic.)
  });
});
