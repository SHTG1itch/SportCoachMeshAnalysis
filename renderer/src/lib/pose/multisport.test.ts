// Multi-sport, sport-agnostic pipeline tests.
//
// Every other end-to-end fixture in this repo is a wrist-keyed tennis forehand
// (Novak/Timo clips, defaultFrame() in compare.test.ts). That leaves the
// sport-agnostic claim — "works for every sport, any keyJoint" — largely
// unverified for the non-wrist path, in particular SOCCER's right_ankle key
// joint, which threads through detectDominantSide, detectPhases, the handedness
// mirror, compare(), and the coach with no test coverage at all.
//
// These tests synthesize biomechanically-plausible motion sequences whose
// WORKING LIMB matches each sport's key joint, then run the REAL compare() +
// coach pipeline and assert sport-agnostic invariants. Synthetic (not real
// footage) on purpose: deterministic, reproducible in plain `npm test` with no
// MediaPipe / browser / network, and able to inject a known joint difference so
// the coach's direction-awareness can be checked exactly.

import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import { generateGuideAndWorkouts } from "../coach";
import { detectPhases } from "./phases";
import { detectDominantSide, jointType } from "./handedness";
import { normalizeAll } from "./normalize";
import { L, type PoseFrame } from "./types";
import { SPORTS, findSport } from "../sports";
import type { AnalysisReport, JointName, SportMeta } from "@shared/types";

// --- synthetic skeleton ------------------------------------------------------

/** A plausible upright athlete in y-up world coordinates (matches the
 * convention used by compare.test.ts's defaultFrame). All 33 landmarks present
 * and fully visible. */
function neutralPose(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 1.5, z: 0, visibility: 1 });
  f[L.NOSE] = { x: 0, y: 1.62, z: 0.05, visibility: 1 };
  f[L.LEFT_SHOULDER] = { x: -0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.RIGHT_SHOULDER] = { x: 0.2, y: 1.4, z: 0, visibility: 1 };
  f[L.LEFT_ELBOW] = { x: -0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.RIGHT_ELBOW] = { x: 0.3, y: 1.1, z: 0, visibility: 1 };
  f[L.LEFT_WRIST] = { x: -0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.RIGHT_WRIST] = { x: 0.35, y: 0.85, z: 0, visibility: 1 };
  f[L.LEFT_HIP] = { x: -0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.RIGHT_HIP] = { x: 0.15, y: 0.9, z: 0, visibility: 1 };
  f[L.LEFT_KNEE] = { x: -0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.RIGHT_KNEE] = { x: 0.15, y: 0.5, z: 0, visibility: 1 };
  f[L.LEFT_ANKLE] = { x: -0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.RIGHT_ANKLE] = { x: 0.15, y: 0.05, z: 0, visibility: 1 };
  f[L.LEFT_HEEL] = { x: -0.15, y: 0.02, z: -0.05, visibility: 1 };
  f[L.RIGHT_HEEL] = { x: 0.15, y: 0.02, z: -0.05, visibility: 1 };
  f[L.LEFT_FOOT_INDEX] = { x: -0.15, y: 0, z: 0.15, visibility: 1 };
  f[L.RIGHT_FOOT_INDEX] = { x: 0.15, y: 0, z: 0.15, visibility: 1 };
  return f;
}

const clone = (f: PoseFrame): PoseFrame => f.map((l) => ({ ...l }));

/** Smoothstep: 0→1 with zero slope at the ends, so its derivative (the limb's
 * speed) peaks at the midpoint — giving detectPhases a clean velocity peak. */
const smooth = (p: number): number => p * p * (3 - 2 * p);

type Deform = (f: PoseFrame, frameIdx: number) => void;

/**
 * Build an N-frame clip whose working limb (chosen from the sport's key-joint
 * TYPE) swings through an arc with a mid-clip speed peak.
 *  - "wrist": the right arm sweeps forward (racket/ball/punch-style motion).
 *  - "ankle": the right leg kicks forward (soccer-style motion).
 * `deform` optionally mutates each frame to inject a controlled difference.
 */
function buildClip(keyType: string, n = 32, deform?: Deform): PoseFrame[] {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const f = neutralPose();
    const s = smooth(i / (n - 1));
    const arc = Math.sin(Math.PI * s); // 0→1→0 vertical lift through the swing
    if (keyType === "ankle") {
      // Right leg kick: ankle (and foot) sweep forward + up; knee extends.
      f[L.RIGHT_KNEE] = { x: 0.15, y: 0.5 + 0.25 * arc, z: -0.1 + 0.5 * s, visibility: 1 };
      f[L.RIGHT_ANKLE] = { x: 0.15, y: 0.05 + 0.45 * arc, z: -0.2 + 0.8 * s, visibility: 1 };
      f[L.RIGHT_FOOT_INDEX] = { x: 0.15, y: 0.02 + 0.45 * arc, z: -0.05 + 0.85 * s, visibility: 1 };
      f[L.RIGHT_HEEL] = { x: 0.15, y: 0.05 + 0.45 * arc, z: -0.25 + 0.8 * s, visibility: 1 };
    } else {
      // Right arm swing: wrist sweeps across + forward; elbow follows partway.
      f[L.RIGHT_ELBOW] = { x: 0.3 - 0.25 * s, y: 1.1 + 0.15 * arc, z: -0.15 + 0.35 * s, visibility: 1 };
      f[L.RIGHT_WRIST] = { x: 0.35 - 0.5 * s, y: 0.85 + 0.35 * arc, z: -0.3 + 0.7 * s, visibility: 1 };
    }
    if (deform) deform(f, i);
    frames.push(f);
  }
  return frames;
}

/** Horizontal mirror of a clip across the sagittal plane: negate x and swap
 * every left/right landmark, so a right-handed motion becomes its left-handed
 * twin (used to test handedness mirroring on non-wrist joints). */
const MIRROR_PAIRS: [number, number][] = [
  [L.LEFT_SHOULDER, L.RIGHT_SHOULDER], [L.LEFT_ELBOW, L.RIGHT_ELBOW],
  [L.LEFT_WRIST, L.RIGHT_WRIST], [L.LEFT_HIP, L.RIGHT_HIP],
  [L.LEFT_KNEE, L.RIGHT_KNEE], [L.LEFT_ANKLE, L.RIGHT_ANKLE],
  [L.LEFT_HEEL, L.RIGHT_HEEL], [L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX],
];
function mirrorClip(frames: PoseFrame[]): PoseFrame[] {
  return frames.map((f) => {
    const out = f.map((l) => ({ ...l, x: -l.x }));
    for (const [a, b] of MIRROR_PAIRS) {
      const t = out[a];
      out[a] = out[b];
      out[b] = t;
    }
    return out;
  });
}

// --- invariant helpers -------------------------------------------------------

const isFiniteNum = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);

/** Assert no NaN/Infinity leaked anywhere into the numeric report. */
function assertReportFinite(report: AnalysisReport): void {
  expect(isFiniteNum(report.overallSimilarity)).toBe(true);
  expect(report.overallSimilarity).toBeGreaterThanOrEqual(0);
  expect(report.overallSimilarity).toBeLessThanOrEqual(1);
  for (const d of report.jointDeltas) {
    for (const k of [
      "meanDeltaDeg", "maxDeltaDeg", "proMeanDeg", "userMeanDeg", "signedBiasDeg",
    ] as const) {
      expect(isFiniteNum(d[k]), `${d.joint}.${k}`).toBe(true);
    }
  }
  if (report.alignment) {
    expect(isFiniteNum(report.alignment.distance)).toBe(true);
    for (const s of report.alignment.similarityTimeline) expect(isFiniteNum(s)).toBe(true);
  }
}

function compareClip(sport: SportMeta, pro: PoseFrame[], user: PoseFrame[]): AnalysisReport {
  return compare({
    sport,
    shot: sport.shots[0],
    pro: { frames: pro, fps: 30, kind: "video" },
    user: { frames: user, fps: 30 },
  });
}

// --- tests -------------------------------------------------------------------

describe("multi-sport pipeline (sport-agnostic, every key joint)", () => {
  it("runs end-to-end for every registered sport without NaN or structural gaps", () => {
    for (const sport of SPORTS) {
      const keyType = jointType(sport.keyJoint);
      const pro = buildClip(keyType);
      const user = buildClip(keyType);
      const report = compareClip(sport, pro, user);

      assertReportFinite(report);
      expect(report.mode, sport.id).toBe("sequence");
      expect(report.jointDeltas.length).toBe(13);
      expect(report.mesh, sport.id).not.toBeNull();
      expect(report.mesh!.pairs.length).toBeGreaterThan(0);
      expect(["left", "right"]).toContain(report.handedness!.pro);
      expect(["left", "right"]).toContain(report.handedness!.user);

      // Coach must produce a usable guide + exactly three workouts for any sport.
      const { guide, workouts } = generateGuideAndWorkouts({
        sport,
        shot: sport.shots[0],
        numericReport: {
          overallSimilarity: report.overallSimilarity,
          jointDeltas: report.jointDeltas,
          phases: report.phases,
          mode: report.mode,
          handedness: report.handedness,
        },
      });
      expect(guide.summary.length, sport.id).toBeGreaterThan(0);
      expect(workouts.length, sport.id).toBe(3);
      for (const w of workouts) {
        expect(w.warmup.length + w.main.length + w.cooldown.length).toBeGreaterThan(0);
        expect(w.durationMin).toBeGreaterThan(0);
        expect(w.id.length).toBeGreaterThan(0);
      }
    }
  });

  it("a clip compared to itself scores ~perfect with no flagged faults (every sport)", () => {
    for (const sport of SPORTS) {
      const keyType = jointType(sport.keyJoint);
      const pro = buildClip(keyType);
      const report = compareClip(sport, pro, pro.map(clone));
      expect(report.overallSimilarity, sport.id).toBeGreaterThanOrEqual(0.99);
      for (const d of report.jointDeltas) {
        expect(Math.abs(d.signedBiasDeg), `${sport.id} ${d.joint}`).toBeLessThan(1);
        expect(d.significance).toBe("low");
      }
    }
  });

  describe("soccer — the right_ankle key-joint path (previously untested)", () => {
    const soccer = findSport("soccer")!;

    it("uses an ankle key joint and detects the kicking (right) leg as dominant", () => {
      expect(soccer.keyJoint).toBe("right_ankle");
      const kick = normalizeAll(buildClip("ankle"));
      expect(detectDominantSide(kick, "ankle")).toBe("right");
    });

    it("decomposes the kick into real phases anchored on the ankle (not the single-phase fallback)", () => {
      const kick = normalizeAll(buildClip("ankle"));
      const phases = detectPhases(kick, "right_ankle", 30);
      expect(phases.length).toBeGreaterThan(1);
      expect(phases.some((p) => p.name === "release")).toBe(true);
      // Phases must tile the clip with no overlap and no gap.
      for (let i = 0; i < phases.length; i++) {
        expect(phases[i].endFrame).toBeGreaterThanOrEqual(phases[i].startFrame);
        if (i > 0) expect(phases[i].startFrame).toBe(phases[i - 1].endFrame + 1);
      }
      expect(phases[0].startFrame).toBe(0);
      expect(phases[phases.length - 1].endFrame).toBe(kick.length - 1);
    });

    it("surfaces per-phase deltas through compare() for a soccer comparison", () => {
      const report = compareClip(soccer, buildClip("ankle"), buildClip("ankle"));
      expect(report.phases.length).toBeGreaterThan(0);
      for (const ph of report.phases) {
        expect(ph.topDeltas.length).toBeGreaterThan(0);
        expect(ph.endFrame).toBeGreaterThanOrEqual(ph.startFrame);
      }
      // The release-phase note is keyed on the actual key joint (right ankle),
      // not a hardcoded wrist — describePhase must stay sport-agnostic.
      const release = report.phases.find((p) => p.name === "release");
      if (release?.note) expect(release.note.toLowerCase()).toContain("ankle");
    });
  });

  it("mirrors a left-footed athlete onto a right-footed pro (handedness on the ankle path)", () => {
    const soccer = findSport("soccer")!;
    const proRight = buildClip("ankle");
    const userLeft = mirrorClip(proRight); // same kick, opposite leg
    const report = compareClip(soccer, proRight, userLeft);
    expect(report.handedness!.mirrored).toBe(true);
    // After mirroring, the lefty's kick should line up limb-for-limb with the
    // righty pro and score as a strong match rather than a spurious mismatch.
    expect(report.overallSimilarity).toBeGreaterThanOrEqual(0.9);
  });

  it("flags the correct joint and direction when a non-key joint differs (direction-aware coaching)", () => {
    // Tennis (wrist swing): the legs are static, so bending the user's right
    // knee forward is a clean, isolated systematic difference the coach should
    // catch and describe with the correct direction ("more" bent → straighten).
    const tennis = findSport("tennis")!;
    const pro = buildClip("wrist");
    const user = buildClip("wrist", 32, (f) => {
      f[L.RIGHT_KNEE] = { x: 0.15, y: 0.55, z: 0.28, visibility: 1 }; // bent forward
    });
    const report = compareClip(tennis, pro, user);

    const knee = report.jointDeltas.find((d) => d.joint === "right_knee")!;
    expect(Math.abs(knee.signedBiasDeg)).toBeGreaterThan(7); // clearly flagged
    expect(knee.signedBiasDeg).toBeGreaterThan(0); // user MORE bent than pro
    expect(report.overallSimilarity).toBeLessThan(0.999); // worse than identical

    const { guide } = generateGuideAndWorkouts({
      sport: tennis,
      shot: "Forehand",
      numericReport: {
        overallSimilarity: report.overallSimilarity,
        jointDeltas: report.jointDeltas,
        phases: report.phases,
        mode: report.mode,
        handedness: report.handedness,
      },
    });
    const kneeIssue = guide.keyIssues.find((k) => k.joint === "right_knee" || k.title.toLowerCase().includes("knee"));
    expect(kneeIssue, "knee should be a flagged key issue").toBeTruthy();
    // "more bent" maps to the straighten-the-knee correction.
    expect(kneeIssue!.fix.toLowerCase()).toContain("straighten");
    expect((kneeIssue!.muscles ?? []).length).toBeGreaterThan(0);
  });

  it("never lists the same joint group as both a fault and a strength (no contradictions)", () => {
    // Across a deformed comparison, the coach's strengths and key issues must be
    // disjoint by body-part group.
    const golf = findSport("golf")!;
    const pro = buildClip("wrist");
    const user = buildClip("wrist", 32, (f) => {
      f[L.RIGHT_KNEE] = { x: 0.15, y: 0.55, z: 0.25, visibility: 1 };
      f[L.RIGHT_ELBOW] = { x: 0.22, y: 1.2, z: -0.05, visibility: 1 };
    });
    const report = compareClip(golf, pro, user);
    const { guide } = generateGuideAndWorkouts({
      sport: golf,
      shot: golf.shots[0],
      numericReport: {
        overallSimilarity: report.overallSimilarity,
        jointDeltas: report.jointDeltas,
        phases: report.phases,
        mode: report.mode,
        handedness: report.handedness,
      },
    });
    const groupOf = (j: JointName): string =>
      ["elbow", "shoulder", "hip", "knee", "ankle"].find((g) => j.endsWith(g)) ?? j;
    const issueGroups = new Set(
      guide.keyIssues
        .map((k) => k.joint)
        .filter((j): j is JointName => !!j)
        .map(groupOf),
    );
    for (const s of guide.strengths) {
      // strengths are prose; just ensure no flagged group name is praised
      for (const g of issueGroups) {
        if (g === "elbow" || g === "knee") {
          // a flagged group must not also appear in a strength sentence
          expect(s.toLowerCase().includes(`your ${g}`)).toBe(false);
        }
      }
    }
  });
});
