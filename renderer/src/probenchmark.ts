// Opt-in live benchmark for the current bundled MediaPipe runtime/model.
// It feeds the committed source pixels through the same fresh-per-clip primary
// VIDEO landmarker used by extractVideo(), then runs the real
// compare() and coaching pipeline. The deterministic fixture regression remains
// in proambenchmark.test.ts; this slower probe verifies that fresh inference has
// not drifted away from that validated behavior.

import type { Handedness, SportMeta } from "@shared/types";
import { generateGuideAndWorkouts } from "./lib/coach";
import { compare } from "./lib/pose/compare";
import { __testing, resetLandmarker } from "./lib/pose/landmarker";
import { detectDominantSide } from "./lib/pose/handedness";
import { L, type PoseFrame } from "./lib/pose/types";

interface LiveCase {
  name: string;
  pro: string;
  amateur: string;
  expectedHandedness: Handedness;
  scoreRange: readonly [number, number];
}

const TENNIS: SportMeta = {
  id: "tennis",
  name: "Tennis",
  shots: ["Forehand"],
  keyJoint: "right_wrist",
  description: "Racket sport",
};

const CASES: readonly LiveCase[] = [
  {
    name: "Djokovic vs right-handed amateur",
    pro: "novak3_fh",
    amateur: "am2_fh",
    expectedHandedness: { pro: "right", user: "right", mirrored: false },
    // Fresh VIDEO inference is allowed a wider band than frozen IMAGE fixtures.
    scoreRange: [0.35, 0.8],
  },
  {
    name: "Djokovic vs left-handed 3.5 amateur",
    pro: "novak4_fh",
    amateur: "am3_fh",
    expectedHandedness: { pro: "right", user: "left", mirrored: true },
    scoreRange: [0.35, 0.8],
  },
];

const status = document.getElementById("status")!;
const output = document.getElementById("out")!;
let text = "";
const emit = (line: string) => {
  text += `${line}\n`;
  output.textContent = text;
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const emptyFrame = (): PoseFrame =>
  Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { willReadFrequently: true })!;
let timestamp = 0;

async function loadBitmap(clip: string, frame: number): Promise<ImageBitmap> {
  const file = `f${String(frame).padStart(4, "0")}.jpg`;
  const response = await fetch(`/testclips/${clip}/${file}`);
  assert(response.ok, `Could not load ${clip}/${file}: HTTP ${response.status}`);
  const blob = await response.blob();
  assert(blob.type.startsWith("image/"), `${clip}/${file} is not an image`);
  return createImageBitmap(blob);
}

async function extractSequence(clip: string): Promise<PoseFrame[]> {
  await resetLandmarker();
  timestamp = 0;
  const primaryLandmarker = await __testing.getLandmarker("VIDEO");
  const frames: PoseFrame[] = [];
  for (let index = 1; index <= 150; index++) {
    const bitmap = await loadBitmap(clip, index);
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    timestamp += 34;
    const primary = __testing.toFrame(primaryLandmarker.detectForVideo(canvas, timestamp));
    bitmap.close();
    frames.push(primary ?? emptyFrame());
    if (index % 15 === 0) status.textContent = `${clip}: ${index}/150`;
  }
  return frames;
}

function coverage(frames: PoseFrame[]): number {
  const core = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
  return frames.filter((frame) => core.every((index) => frame[index].visibility >= 0.3)).length /
    frames.length;
}

async function main(): Promise<void> {
  await resetLandmarker();
  const extracted = new Map<string, PoseFrame[]>();
  for (const clip of new Set(CASES.flatMap((entry) => [entry.pro, entry.amateur]))) {
    status.textContent = `${clip}: loading model`;
    const frames = await extractSequence(clip);
    extracted.set(clip, frames);
    const detected = coverage(frames);
    emit(`${clip}: 150 frames, ${(detected * 100).toFixed(1)}% core-pose coverage`);
    assert(detected >= 0.2, `${clip} fell below the program's 20% usable-pose floor`);
  }

  for (const benchmark of CASES) {
    const pro = extracted.get(benchmark.pro)!;
    const amateur = extracted.get(benchmark.amateur)!;
    const run = (user: PoseFrame[]) =>
      compare({
        sport: TENNIS,
        shot: "Forehand",
        pro: { frames: pro, fps: 30, kind: "video" },
        user: { frames: user, fps: 30 },
      });
    const control = run(pro.map((frame) => frame.map((landmark) => ({ ...landmark }))));
    const report = run(amateur);
    const coaching = generateGuideAndWorkouts({
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
    const significant = report.jointDeltas.filter((delta) => delta.significance !== "low");
    emit(
      `${benchmark.name}: self=${control.overallSimilarity.toFixed(3)} ` +
        `pro/amateur=${report.overallSimilarity.toFixed(3)} ` +
        `motion=${detectDominantSide(pro, "wrist")}/${detectDominantSide(amateur, "wrist")} ` +
        `handedness=${JSON.stringify(report.handedness)} issues=${coaching.guide.keyIssues.length}`,
    );
    assert(control.overallSimilarity >= 0.99, `${benchmark.name}: self-control regressed`);
    assert(report.handedness !== undefined, `${benchmark.name}: handedness missing`);
    assert(
      JSON.stringify(report.handedness) === JSON.stringify(benchmark.expectedHandedness),
      `${benchmark.name}: handedness was ${JSON.stringify(report.handedness)}`,
    );
    assert(
      report.overallSimilarity >= benchmark.scoreRange[0] &&
        report.overallSimilarity <= benchmark.scoreRange[1],
      `${benchmark.name}: score ${report.overallSimilarity} escaped ${benchmark.scoreRange.join("-")}`,
    );
    assert(
      control.overallSimilarity - report.overallSimilarity >= 0.2,
      `${benchmark.name}: lost the exact-match versus amateur separation`,
    );
    assert(significant.length > 0, `${benchmark.name}: no technique difference was surfaced`);
    assert(coaching.guide.keyIssues.length > 0, `${benchmark.name}: no coaching issue was generated`);
    assert(coaching.workouts.length === 3, `${benchmark.name}: expected three workouts`);
  }

  emit("Live professional-amateur benchmark passed");
  status.textContent = "DONE";
  await resetLandmarker();
}

main().catch(async (error) => {
  emit(error instanceof Error ? error.stack ?? error.message : String(error));
  status.textContent = "ERROR";
  await resetLandmarker();
});
