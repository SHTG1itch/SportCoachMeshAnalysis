// Pro-as-image single-frame end-to-end test (caveat 2: "single-frame pro-as-image
// mode is unit-tested only"). Exercises the image branch of the app's pipeline
// flake-free, without <video> decode (which is throttled in driven tabs):
//
//   1. Load the pro still as an HTMLImageElement — EXACTLY as analyze.ts
//      loadMedia(file,"image") does — and run the app's real detectImage(img).
//      This is the literal pro-image input path the app uses.
//   2. Extract the user frames via IMAGE-mode detection on a JPG sequence (the
//      proven-reliable stills path; the user <video> path is caveat 1's concern
//      and is validated separately).
//   3. proFrames=[proFrame], proFps=1 → compare(kind="image") → single_frame →
//      coach, mirroring analyze.ts's image branch.
//
// Results POST to :5174 for disk-readable verification.

import { detectImage, resetLandmarker } from "./lib/pose/landmarker";
import { compare } from "./lib/pose/compare";
import { generateGuideAndWorkouts } from "./lib/coach";
import { findSport } from "./lib/sports";
import { L, type PoseFrame } from "./lib/pose/types";

const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";
function post() {
  fetch(`http://localhost:5174/result?name=imgtest`, { method: "POST", body: `STATUS: ${curStatus}\n${buf}` }).catch(() => {});
}
let pending: number | null = null;
function emit(s = "") { buf += s + "\n"; outEl.textContent = buf; if (pending === null) pending = window.setTimeout(() => { pending = null; post(); }, 300); }
function setStatus(s: string) { curStatus = s; statusEl.textContent = s; }
function flush() { if (pending) { clearTimeout(pending); pending = null; } post(); }
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));

const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
const isDet = (f: PoseFrame) => CORE.every((i) => f[i] && f[i].visibility >= 0.3);

function emptyFrame(): PoseFrame {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
}

// Mirrors analyze.ts loadMedia(file, "image"): an HTMLImageElement from a URL.
function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

async function extractUserStills(clip: string, max: number): Promise<PoseFrame[]> {
  const frames: PoseFrame[] = [];
  for (let i = 1; i <= max; i++) {
    const res = await fetch(`/testclips/${clip}/f${String(i).padStart(4, "0")}.jpg`);
    if (!res.ok) break;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) break;
    const bmp = await createImageBitmap(blob);
    frames.push((await detectImage(bmp)) ?? emptyFrame());
    bmp.close();
    if (i % 20 === 0) setStatus(`user frame ${i}`);
  }
  return frames;
}

async function main() {
  emit(`===== PRO-AS-IMAGE single_frame end-to-end (real detectImage + compare + coach) =====`);
  await resetLandmarker();
  const sport = findSport("tennis")!;

  // Step 1: the actual pro-image input path — HTMLImageElement → detectImage.
  setStatus("detecting pro image");
  const proImg = await loadImageEl("/testclips/novak_fh/f0075.jpg");
  emit(`  pro image loaded: ${proImg.naturalWidth}x${proImg.naturalHeight}`);
  const proFrame = await detectImage(proImg);
  if (!proFrame) { emit(`  ✗ detectImage returned null on the pro image`); setStatus("ERROR"); flush(); return; }
  emit(`  ✓ detectImage(HTMLImageElement) detected a pose (core-detected=${isDet(proFrame)})`);

  // Step 2: user frames (reliable stills path).
  setStatus("extracting user");
  const userFrames = await extractUserStills("timo_fh", 120);
  emit(`  user frames: ${userFrames.length} (detected ${userFrames.filter(isDet).length})`);

  // Step 3: single_frame compare + coach (analyze.ts image branch: proFps=1).
  const report = compare({
    sport,
    shot: "Forehand",
    pro: { frames: [proFrame], fps: 1, kind: "image" },
    user: { frames: userFrames, fps: 30 },
  });
  const gw = generateGuideAndWorkouts({
    sport, shot: "Forehand",
    numericReport: {
      overallSimilarity: report.overallSimilarity,
      jointDeltas: report.jointDeltas,
      phases: report.phases,
      mode: report.mode,
      handedness: report.handedness,
    },
  });
  emit(`\n  RESULT:`);
  emit(`    mode=${report.mode}  (expected single_frame)`);
  emit(`    keyUserFrame=${report.keyUserFrame}  alignment=${report.alignment ? "present" : "null (correct)"}  phases=${report.phases.length}`);
  emit(`    overallSimilarity=${f2(report.overallSimilarity)}  handedness=${JSON.stringify(report.handedness)}`);
  emit(`    top deltas: ${report.jointDeltas.slice(0, 4).map((d) => `${d.joint} bias${f2(d.signedBiasDeg)}(${d.significance})`).join(", ")}`);
  emit(`    guide.summary: ${gw.guide.summary}`);
  emit(`    keyIssues: ${gw.guide.keyIssues.map((k) => k.title).join(" | ")}`);
  emit(`    workouts: ${gw.workouts.map((w) => w.title).join(" | ")}`);
  const ok = report.mode === "single_frame" && report.keyUserFrame !== null && report.alignment === null && !!gw.guide && gw.workouts.length > 0;
  emit(`\n  VERDICT: ${ok ? "✓ pro-as-image resolves single_frame mode, a best-matching user frame, handedness, guide + workouts" : "✗ unexpected output"}`);
  emit(`\n===== DONE =====`);
  setStatus("DONE");
  flush();
}

window.addEventListener("pagehide", () => { void resetLandmarker(); });
main().catch((e) => { setStatus("ERROR"); emit(`\nERROR: ${e?.stack || e}`); flush(); console.error(e); });
