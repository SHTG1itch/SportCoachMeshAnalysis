// Shared-landmarker topology probe (dev-only). Closes the one gap in the
// IMAGE-vs-VIDEO parity check: modeprobe extracted each clip on a FRESH VIDEO
// landmarker, but the app (and the videoClock fix) share ONE VIDEO landmarker
// across pro→user with no reset — so the user clip's first frames track from the
// pro's last pose. This reproduces that exact topology with the FIXED monotonic
// clock and measures whether cross-clip tracking contaminates the user frames
// enough to move the REAL rubric.
//
//   Pass A (pro = novak_fh): shared landmarker, clock from 0.
//   Pass B (user = timo_fh): SAME landmarker, clock CONTINUED (the fix).
//   Pass C (user = timo_fh): FRESH landmarker — the "no contamination" baseline.
// Then diff B vs C (esp. the first frames) and run the REAL rubric on the
// shared-topology frames. Results POST to :5174.

import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { resetLandmarker } from "./lib/pose/landmarker";
import { compare } from "./lib/pose/compare";
import { computeAngles, JOINT_FEATURES } from "./lib/pose/angles";
import { findSport } from "./lib/sports";
import { type PoseFrame } from "./lib/pose/types";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";

const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";
function post() { fetch(`http://localhost:5174/result?name=sharedprobe`, { method: "POST", body: `STATUS: ${curStatus}\n${buf}` }).catch(() => {}); }
let pending: number | null = null;
function emit(s = "") { buf += s + "\n"; outEl.textContent = buf; if (pending === null) pending = window.setTimeout(() => { pending = null; post(); }, 300); }
function setStatus(s: string) { curStatus = s; statusEl.textContent = s; }
function flush() { if (pending) { clearTimeout(pending); pending = null; } post(); }
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));

function emptyFrame(): PoseFrame { return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })); }
function toFrame(r: PoseLandmarkerResult): PoseFrame | null {
  if (!r.worldLandmarks?.length) return null;
  const lms = r.worldLandmarks[0];
  if (!lms || lms.length < 33) return null;
  return Array.from({ length: 33 }, (_, i) => ({ x: lms[i].x, y: lms[i].y, z: lms[i].z, visibility: (lms[i] as { visibility?: number }).visibility ?? 1 }));
}
async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null;
  return createImageBitmap(blob);
}
async function buildVideoLm(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO", numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

// Feed a clip into a given landmarker with the FIXED clock scheme starting at `base`.
async function feed(lm: PoseLandmarker, clip: string, label: string, max: number, base: number): Promise<{ frames: PoseFrame[]; endClock: number }> {
  const frames: PoseFrame[] = [];
  let lastTs = base;
  for (let i = 1; i <= max; i++) {
    const bmp = await loadBitmap(`/testclips/${clip}/f${String(i).padStart(4, "0")}.jpg`);
    if (!bmp) break;
    canvas.width = bmp.width; canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    let ts = base + Math.round((i - 0.5) * 33.3667);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    frames.push(toFrame(lm.detectForVideo(canvas, ts)) ?? emptyFrame());
    bmp.close();
    if (i % 20 === 0) setStatus(`${label} frame ${i}`);
  }
  return { frames, endClock: lastTs + 1 };
}

function frameDiff(a: PoseFrame, b: PoseFrame): { l2: number; ang: number } {
  let s = 0;
  for (let i = 0; i < 33; i++) { const dx = a[i].x - b[i].x, dy = a[i].y - b[i].y, dz = a[i].z - b[i].z; s += Math.sqrt(dx * dx + dy * dy + dz * dz); }
  const aa = computeAngles(a), ab = computeAngles(b);
  let as = 0; for (let i = 0; i < JOINT_FEATURES.length; i++) as += Math.abs(aa[i] - ab[i]);
  return { l2: s / 33, ang: as / JOINT_FEATURES.length };
}

async function main() {
  emit(`Shared-landmarker topology probe — reproduces the app's pro→user single-landmarker extraction with the videoClock fix.`);

  // --- Shared topology: pro then user on ONE landmarker, no reset between. ---
  setStatus("shared: pro");
  await resetLandmarker();
  const shared = await buildVideoLm();
  emit(`\n[SHARED] one VIDEO landmarker, no reset between passes:`);
  const proPass = await feed(shared, "novak_fh", "shared/pro novak_fh", 150, 0);
  emit(`  pass A (pro novak_fh): ${proPass.frames.length} frames, endClock=${proPass.endClock}`);
  const userShared = await feed(shared, "timo_fh", "shared/user timo_fh", 120, proPass.endClock);
  emit(`  pass B (user timo_fh): ${userShared.frames.length} frames (clock continued from pro — the real app topology)`);
  shared.close();

  // --- Baseline: user on a FRESH landmarker (no cross-clip tracking). ---
  setStatus("fresh: user");
  await resetLandmarker();
  const fresh = await buildVideoLm();
  const userFresh = await feed(fresh, "timo_fh", "fresh/user timo_fh", 120, 0);
  fresh.close();
  emit(`  baseline (fresh user timo_fh): ${userFresh.frames.length} frames`);

  // --- Contamination: diff shared-topology user frames vs fresh user frames. ---
  const n = Math.min(userShared.frames.length, userFresh.frames.length);
  const diffs = Array.from({ length: n }, (_, i) => frameDiff(userShared.frames[i], userFresh.frames[i]));
  const first5 = diffs.slice(0, 5);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  emit(`\n[CONTAMINATION] shared-topology user frames vs fresh user frames:`);
  emit(`  first 5 frames: ${first5.map((d, i) => `f${i + 1}:L2=${f2(d.l2)},ang=${f2(d.ang)}°`).join("  ")}`);
  emit(`  whole clip: mean L2=${f2(mean(diffs.map((d) => d.l2)))}m  mean ang=${f2(mean(diffs.map((d) => d.ang)))}°  maxL2=${f2(Math.max(...diffs.map((d) => d.l2)))}  maxAng=${f2(Math.max(...diffs.map((d) => d.ang)))}°`);

  // --- REAL rubric on shared-topology frames (vs the modeeval fresh result ~0.569). ---
  const sport = findSport("tennis")!;
  const cmp = (u: PoseFrame[]) => compare({ sport, shot: "Forehand", pro: { frames: proPass.frames, fps: 30, kind: "video" }, user: { frames: u, fps: 30 } });
  const rShared = cmp(userShared.frames);
  const rFresh = cmp(userFresh.frames);
  const sig = (r: ReturnType<typeof cmp>) => `${r.jointDeltas.filter((d) => d.significance === "high").length}h/${r.jointDeltas.filter((d) => d.significance === "medium").length}m`;
  emit(`\n[REAL RUBRIC] novak(pro) vs timo(user), shared-topology vs fresh user extraction:`);
  emit(`  SHARED: sim=${f2(rShared.overallSimilarity)} ${sig(rShared)} handedness=${JSON.stringify(rShared.handedness)}`);
  emit(`  FRESH : sim=${f2(rFresh.overallSimilarity)} ${sig(rFresh)} handedness=${JSON.stringify(rFresh.handedness)}`);
  emit(`  Δsim = ${f2(Math.abs(rShared.overallSimilarity - rFresh.overallSimilarity))}`);
  const ok = Math.abs(rShared.overallSimilarity - rFresh.overallSimilarity) < 0.03 &&
    JSON.stringify(rShared.handedness) === JSON.stringify(rFresh.handedness);
  emit(`  VERDICT: ${ok ? "✓ shared-landmarker topology does NOT change the rubric — parity holds under the app's actual extraction" : "⚠ shared topology shifted the rubric — investigate"}`);

  emit(`\n===== DONE =====`);
  setStatus("DONE");
  flush();
}

window.addEventListener("pagehide", () => { void resetLandmarker(); });
main().catch((e) => { setStatus("ERROR"); emit(`\nERROR: ${e?.stack || e}`); flush(); console.error(e); });
