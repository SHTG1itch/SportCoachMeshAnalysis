// Generates real AnalysisRecord JSON fixtures for the visual result-screen test
// (apptest.html). NOT a unit test — a fixture generator. Loads pose frames the
// harness already captured (frames_novak_fh.txt / frames_timo_fh.txt), runs the
// REAL compare()+coach pipeline, and writes complete AnalysisRecords (with guide
// + workouts) to renderer/public/ so the browser can fetch and render them
// through the actual <AnalysisResult> component with zero MediaPipe dependency.
//
// Produces both modes so the screen's branches are all exercised:
//   - sample_seq.json    : sequence mode (DTW alignment chart, phases)
//   - sample_single.json : single_frame mode (keyUserFrame, no phases)
//
// Run with:  REAL_EVAL=1 npx vitest run gensample
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./compare";
import { generateGuideAndWorkouts } from "../coach";
import { type PoseFrame } from "./types";
import type { AnalysisRecord, AnalysisReport, SportMeta } from "@shared/types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
const PUBLIC = path.resolve(process.cwd(), "renderer", "public");
const load = (name: string): { fps: number; frames: PoseFrame[] } | null => {
  const p = path.join(RESULTS, `frames_${name}.txt`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

const TENNIS: SportMeta = {
  id: "tennis",
  name: "Tennis",
  shots: ["Forehand"],
  keyJoint: "right_wrist",
  description: "Racket sport",
};

function withGuide(report: AnalysisReport): AnalysisReport {
  const gw = generateGuideAndWorkouts({
    sport: TENNIS,
    shot: "Forehand",
    numericReport: {
      overallSimilarity: report.overallSimilarity,
      jointDeltas: report.jointDeltas,
      phases: report.phases,
      mode: report.mode,
      handedness: report.handedness,
    },
  });
  return { ...report, guide: gw.guide, workouts: gw.workouts };
}

function record(report: AnalysisReport): AnalysisRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sportId: "tennis",
    shot: "Forehand",
    report,
  };
}

const ENABLED = !!process.env.REAL_EVAL;
describe("generate visual-test fixtures", () => {
  const novak = ENABLED ? load("novak_fh") : null;
  const timo = ENABLED ? load("timo_fh") : null;
  it.skipIf(!novak || !timo)("write sample_seq.json + sample_single.json", () => {
    // Sequence mode: pro=novak (video), user=timo (video).
    const seq = withGuide(
      compare({
        sport: TENNIS,
        shot: "Forehand",
        pro: { frames: novak!.frames, fps: novak!.fps, kind: "video" },
        user: { frames: timo!.frames, fps: timo!.fps },
      }),
    );
    fs.writeFileSync(path.join(PUBLIC, "sample_seq.json"), JSON.stringify(record(seq)));

    // Single-frame mode: pro = a single mid-clip novak frame treated as an image.
    const mid = Math.floor(novak!.frames.length / 2);
    const single = withGuide(
      compare({
        sport: TENNIS,
        shot: "Forehand",
        pro: { frames: [novak!.frames[mid]], fps: 1, kind: "image" },
        user: { frames: timo!.frames, fps: timo!.fps },
      }),
    );
    fs.writeFileSync(path.join(PUBLIC, "sample_single.json"), JSON.stringify(record(single)));

    // eslint-disable-next-line no-console
    console.log(
      `seq: mode=${seq.mode} sim=${seq.overallSimilarity} phases=${seq.phases.length} workouts=${seq.workouts.length} guide=${!!seq.guide}\n` +
        `single: mode=${single.mode} sim=${single.overallSimilarity} keyUserFrame=${single.keyUserFrame} workouts=${single.workouts.length} guide=${!!single.guide}`,
    );
  });
});
