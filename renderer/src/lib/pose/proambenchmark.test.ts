import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnalysisReport, Handedness, SportMeta } from "@shared/types";
import { generateGuideAndWorkouts } from "../coach";
import { compare } from "./compare";
import { L, type PoseFrame } from "./types";

interface PoseFixture {
  fps: number;
  kind: "video";
  frames: PoseFrame[];
}

interface BenchmarkCase {
  name: string;
  proFixture: string;
  amateurFixture: string;
  sport: SportMeta;
  shot: string;
  expectedHandedness: Handedness;
  scoreRange: readonly [number, number];
  minimumCoverage: readonly [number, number];
}

const RESULTS = path.resolve(process.cwd(), "harness-results");
const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];

const TENNIS: SportMeta = {
  id: "tennis",
  name: "Tennis",
  shots: ["Forehand"],
  keyJoint: "right_wrist",
  description: "Racket sport",
};

const BASKETBALL: SportMeta = {
  id: "basketball",
  name: "Basketball",
  shots: ["Free throw"],
  keyJoint: "right_wrist",
  description: "Shooting motion",
};

/**
 * Real detector-output benchmarks. The tennis labels and clips were checked
 * against their source footage before the landmark fixtures were committed:
 *
 * - Djokovic practice vs right-handed amateur (YouTube JMa5xHfJlBg,
 *   64.5-69.5s; pmrO4LQmVAY, 35.5-40.5s).
 * - Djokovic groundstroke training vs left-handed 3.5 amateur (YouTube
 *   RPOlYGD4aGo, 2.5-7.5s; RwEF_Mty7Ps, 89.5-94.5s).
 * - A CC-licensed Wikimedia Commons free throw pair captured in Electron.
 *
 * These cases validate comparison-to-reference behavior, not a universal
 * classifier of athletic skill. Camera angle, shot selection, and body shape
 * all affect a monocular-pose similarity score, so the defensible invariant is
 * that each labeled comparison remains finite, directionally meaningful,
 * well below its exact-match control, and inside its empirically audited band.
 */
const CASES: readonly BenchmarkCase[] = [
  {
    name: "Djokovic vs right-handed amateur forehand",
    proFixture: "novak3_fh",
    amateurFixture: "am2_fh",
    sport: TENNIS,
    shot: "Forehand",
    expectedHandedness: { pro: "right", user: "right", mirrored: false },
    scoreRange: [0.5, 0.7],
    minimumCoverage: [0.85, 0.95],
  },
  {
    name: "Djokovic vs left-handed 3.5 amateur forehand",
    proFixture: "novak4_fh",
    amateurFixture: "am3_fh",
    sport: TENNIS,
    shot: "Forehand",
    expectedHandedness: { pro: "right", user: "left", mirrored: true },
    scoreRange: [0.45, 0.65],
    minimumCoverage: [0.95, 0.8],
  },
  {
    name: "professional vs amateur free throw",
    proFixture: "bball_pro",
    amateurFixture: "bball_am",
    sport: BASKETBALL,
    shot: "Free throw",
    expectedHandedness: { pro: "left", user: "right", mirrored: true },
    scoreRange: [0.4, 0.72],
    minimumCoverage: [0.85, 0.7],
  },
];

function loadFixture(name: string): PoseFixture {
  const file = path.join(RESULTS, `frames_${name}.txt`);
  expect(fs.existsSync(file), `required benchmark fixture ${file}`).toBe(true);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PoseFixture>;
  expect(parsed.kind, `${name}.kind`).toBe("video");
  expect(Number.isFinite(parsed.fps), `${name}.fps`).toBe(true);
  expect(parsed.fps!, `${name}.fps`).toBeGreaterThan(0);
  expect(Array.isArray(parsed.frames), `${name}.frames`).toBe(true);
  expect(parsed.frames!.length, `${name}.frames`).toBeGreaterThanOrEqual(20);

  for (let frameIndex = 0; frameIndex < parsed.frames!.length; frameIndex++) {
    const frame = parsed.frames![frameIndex];
    expect(frame, `${name}[${frameIndex}]`).toHaveLength(33);
    for (let landmarkIndex = 0; landmarkIndex < frame.length; landmarkIndex++) {
      const landmark = frame[landmarkIndex];
      for (const key of ["x", "y", "z", "visibility"] as const) {
        expect(
          Number.isFinite(landmark[key]),
          `${name}[${frameIndex}][${landmarkIndex}].${key}`,
        ).toBe(true);
      }
      expect(landmark.visibility).toBeGreaterThanOrEqual(0);
      expect(landmark.visibility).toBeLessThanOrEqual(1);
    }
  }
  return parsed as PoseFixture;
}

function clone(frames: PoseFrame[]): PoseFrame[] {
  return frames.map((frame) => frame.map((landmark) => ({ ...landmark })));
}

function runBenchmark(c: BenchmarkCase, pro: PoseFixture, amateur: PoseFixture): AnalysisReport {
  return compare({
    sport: c.sport,
    shot: c.shot,
    pro: { frames: pro.frames, fps: pro.fps, kind: "video" },
    user: { frames: amateur.frames, fps: amateur.fps },
  });
}

function expectFiniteReport(report: AnalysisReport): void {
  expect(report.mode).toBe("sequence");
  expect(Number.isFinite(report.overallSimilarity)).toBe(true);
  expect(report.overallSimilarity).toBeGreaterThanOrEqual(0);
  expect(report.overallSimilarity).toBeLessThanOrEqual(1);
  expect(report.alignment).not.toBeNull();
  expect(report.alignment!.path.length).toBeGreaterThan(0);
  // The timeline has one aggregate point per compared pro frame; the DTW path
  // can contain more points when multiple user frames align to one pro frame.
  expect(report.alignment!.similarityTimeline).toHaveLength(report.proFrameCount);

  for (const value of report.alignment!.similarityTimeline) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  for (const [proIndex, userIndex] of report.alignment!.path) {
    expect(proIndex).toBeGreaterThanOrEqual(0);
    expect(proIndex).toBeLessThan(report.proFrameCount);
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeLessThan(report.userFrameCount);
  }
  for (const delta of report.jointDeltas) {
    for (const key of [
      "meanDeltaDeg",
      "maxDeltaDeg",
      "proMeanDeg",
      "userMeanDeg",
      "signedBiasDeg",
    ] as const) {
      expect(Number.isFinite(delta[key]), `${delta.joint}.${key}`).toBe(true);
    }
    if (delta.avgConf !== undefined) {
      expect(delta.avgConf).toBeGreaterThanOrEqual(0);
      expect(delta.avgConf).toBeLessThanOrEqual(1);
    }
  }

  let previousEnd = -1;
  for (const phase of report.phases) {
    expect(Number.isInteger(phase.startFrame)).toBe(true);
    expect(Number.isInteger(phase.endFrame)).toBe(true);
    expect(phase.startFrame).toBeGreaterThan(previousEnd);
    expect(phase.endFrame).toBeGreaterThanOrEqual(phase.startFrame);
    // Displayed phases intentionally use original source-clip frame numbers,
    // while proFrameCount describes the active-window frames sent to DTW.
    expect(phase.endFrame).toBeLessThan(Math.round(report.durationSecPro * report.proFps));
    previousEnd = phase.endFrame;
  }

  expect(report.mesh).toBeTruthy();
  expect(report.mesh!.pairs.length).toBeGreaterThan(0);
  expect(report.mesh!.keyIndex).toBeGreaterThanOrEqual(0);
  expect(report.mesh!.keyIndex).toBeLessThan(report.mesh!.pairs.length);
  for (const pair of report.mesh!.pairs) {
    expect(pair.pro).toHaveLength(33);
    expect(pair.user).toHaveLength(33);
    for (const landmark of [...pair.pro, ...pair.user]) {
      expect(
        [landmark.x, landmark.y, landmark.z, landmark.visibility].every(Number.isFinite),
      ).toBe(true);
    }
  }
}

describe("real professional-versus-amateur benchmark", () => {
  for (const benchmark of CASES) {
    it(`${benchmark.name}: fixtures are complete real pose sequences`, () => {
      const pro = loadFixture(benchmark.proFixture);
      const amateur = loadFixture(benchmark.amateurFixture);
      expect(pro.fps).toBe(30);
      expect(amateur.fps).toBe(30);
      expect(
        pro.frames.filter((frame) => CORE.every((index) => frame[index].visibility >= 0.3))
          .length / pro.frames.length,
      ).toBeGreaterThanOrEqual(benchmark.minimumCoverage[0]);
      expect(
        amateur.frames.filter((frame) => CORE.every((index) => frame[index].visibility >= 0.3))
          .length / amateur.frames.length,
      ).toBeGreaterThanOrEqual(benchmark.minimumCoverage[1]);
    });

    it(`${benchmark.name}: exact-match control stays near perfect`, () => {
      const pro = loadFixture(benchmark.proFixture);
      const control = compare({
        sport: benchmark.sport,
        shot: benchmark.shot,
        pro: { frames: pro.frames, fps: pro.fps, kind: "video" },
        user: { frames: clone(pro.frames), fps: pro.fps },
      });
      expectFiniteReport(control);
      expect(control.overallSimilarity).toBeGreaterThanOrEqual(0.995);
      expect(control.jointDeltas.filter((delta) => delta.significance !== "low")).toHaveLength(0);
    });

    it(`${benchmark.name}: comparison remains calibrated, actionable, and deterministic`, () => {
      const pro = loadFixture(benchmark.proFixture);
      const amateur = loadFixture(benchmark.amateurFixture);
      const report = runBenchmark(benchmark, pro, amateur);
      expectFiniteReport(report);

      expect(report.handedness).toEqual(benchmark.expectedHandedness);
      expect(report.coverage!.pro).toBeGreaterThanOrEqual(benchmark.minimumCoverage[0]);
      expect(report.coverage!.user).toBeGreaterThanOrEqual(benchmark.minimumCoverage[1]);
      expect(report.overallSimilarity).toBeGreaterThanOrEqual(benchmark.scoreRange[0]);
      expect(report.overallSimilarity).toBeLessThanOrEqual(benchmark.scoreRange[1]);
      expect(1 - report.overallSimilarity).toBeGreaterThanOrEqual(0.25);

      const significant = report.jointDeltas.filter(
        (delta) => delta.significance === "medium" || delta.significance === "high",
      );
      expect(significant.length).toBeGreaterThan(0);

      const coaching = generateGuideAndWorkouts({
        sport: benchmark.sport,
        shot: benchmark.shot,
        numericReport: {
          overallSimilarity: report.overallSimilarity,
          jointDeltas: report.jointDeltas,
          phases: report.phases,
          mode: report.mode,
          handedness: report.handedness,
        },
      });
      expect(coaching.guide.keyIssues.length).toBeGreaterThan(0);
      expect(coaching.workouts).toHaveLength(3);
      for (const issue of coaching.guide.keyIssues) {
        expect(issue.joint).toBeTruthy();
        expect(significant.some((delta) => delta.joint === issue.joint)).toBe(true);
        expect(issue.observation).toContain("°");
        expect(issue.fix.toLowerCase()).toContain("match the pro");
        expect(issue.muscles?.length).toBeGreaterThan(0);
      }
      for (const workout of coaching.workouts) {
        expect(workout.targetsJoints.length).toBeGreaterThan(0);
        expect(workout.targetsMuscles?.length).toBeGreaterThan(0);
        expect(workout.main.length).toBeGreaterThan(0);
      }

      const repeated = runBenchmark(benchmark, pro, amateur);
      expect(repeated).toEqual(report);
    });
  }
});
