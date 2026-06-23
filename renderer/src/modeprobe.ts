// IMAGE-vs-VIDEO mode parity probe (dev-only fixture, not in the shipped app).
//
// Validates the scope caveat "the harness extracts poses in MediaPipe IMAGE mode
// while the app uses VIDEO mode". It does so WITHOUT any <video> decode (which is
// throttled in background/driven tabs) by feeding the SAME JPG pixels the harness
// uses into BOTH:
//   - the app's own detectImage()  (IMAGE-mode landmarker)
//   - a VIDEO-mode landmarker built with options identical to landmarker.ts,
//     calling detectForVideo(canvas, ts)
// and diffing the resulting worldLandmarks + joint angles per frame.
//
// It also reproduces the app's exact two-call timestamp pattern: runAnalysis
// calls extractVideo twice (pro, then user) on ONE cached VIDEO landmarker, and
// each call's timestamps restart near 0. MediaPipe detectForVideo requires
// monotonically increasing timestamps, so the second (user) pass may throw. We
// reproduce that here on a single landmarker instance and report what happens.
//
// Results are POSTed to the :5174 file server so they are readable from disk
// regardless of the (flaky) browser extension connection.

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { detectImage, resetLandmarker } from "./lib/pose/landmarker";
import { computeAngles, JOINT_FEATURES } from "./lib/pose/angles";
import { L, type PoseFrame, type Landmark3D } from "./lib/pose/types";

// --- Identical to landmarker.ts ---
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";

async function buildVideoLandmarker(): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

function toFrame(result: PoseLandmarkerResult): PoseFrame | null {
  if (!result.worldLandmarks || result.worldLandmarks.length === 0) return null;
  const lms = result.worldLandmarks[0];
  if (!lms || lms.length < 33) return null;
  const out: PoseFrame = [];
  for (let i = 0; i < 33; i++) {
    const l = lms[i];
    const lm: Landmark3D = {
      x: l.x,
      y: l.y,
      z: l.z,
      visibility: (l as { visibility?: number }).visibility ?? 1,
    };
    out.push(lm);
  }
  return out;
}

function emptyFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 0 });
  return f;
}

// --- Output plumbing (POST to file server + on-page text) ---
const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";
function postText(name: string, body: string) {
  fetch(`http://localhost:5174/result?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body,
  }).catch(() => {});
}
let pending: number | null = null;
function flush() {
  pending = null;
  postText("modeprobe", `STATUS: ${curStatus}\n${buf}`);
}
function emit(s = "") {
  buf += s + "\n";
  outEl.textContent = buf;
  if (pending === null) pending = window.setTimeout(flush, 400);
}
function setStatus(s: string) {
  curStatus = s;
  statusEl.textContent = s;
}
async function postRaw(name: string, obj: unknown) {
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const body = JSON.stringify(obj, (_k, v) => (typeof v === "number" ? round(v) : v));
  try {
    await fetch(`http://localhost:5174/result?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body,
    });
    emit(`  saved ${name} (${body.length} bytes)`);
  } catch (e) {
    emit(`  save ${name} FAILED: ${e}`);
  }
}

const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
const isDet = (f: PoseFrame) => CORE.every((i) => f[i] && f[i].visibility >= 0.3);
function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(xs: number[], p: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}
function landmarkL2(a: PoseFrame, b: PoseFrame): { meanL2: number; maxL2: number } {
  let sum = 0, max = 0;
  for (let i = 0; i < 33; i++) {
    const dx = a[i].x - b[i].x, dy = a[i].y - b[i].y, dz = a[i].z - b[i].z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    sum += d;
    if (d > max) max = d;
  }
  return { meanL2: sum / 33, maxL2: max };
}
function angleDiff(a: PoseFrame, b: PoseFrame): { meanAbs: number; max: number } {
  const aa = computeAngles(a), ab = computeAngles(b);
  let sum = 0, max = 0;
  for (let i = 0; i < JOINT_FEATURES.length; i++) {
    const d = Math.abs(aa[i] - ab[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { meanAbs: sum / JOINT_FEATURES.length, max };
}

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null; // Vite SPA fallback => not a real frame
  return createImageBitmap(blob);
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

/** PHASE 1: per-clip IMAGE vs VIDEO divergence on identical pixels. Fresh VIDEO
 * landmarker per clip so tracking state is clean (isolates the mode difference,
 * not cross-clip contamination). */
async function divergenceForClip(clip: string, maxFrames: number) {
  emit(`\n===== DIVERGENCE: ${clip} =====`);
  await resetLandmarker(); // reset the app's cached IMAGE landmarker too, for cleanliness
  const vid = await buildVideoLandmarker();
  const vidFrames: PoseFrame[] = [];
  const imgFrames: PoseFrame[] = [];
  const meanL2s: number[] = [];
  const maxL2s: number[] = [];
  const angMeans: number[] = [];
  const angMaxs: number[] = [];
  let imgDet = 0, vidDet = 0, bothDet = 0, detMismatch = 0;
  let n = 0;
  for (let i = 1; i <= maxFrames; i++) {
    const url = `/testclips/${clip}/f${String(i).padStart(4, "0")}.jpg`;
    const bmp = await loadBitmap(url);
    if (!bmp) break;
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    // IMAGE mode (app's own detectImage, IMAGE-mode landmarker).
    const imgF = (await detectImage(bmp)) ?? emptyFrame();
    // VIDEO mode (detectForVideo on identical pixels, ascending ts).
    const ts = Math.round((i - 0.5) * 33.3667); // ~30fps spacing, monotonic
    let vidF: PoseFrame;
    try {
      vidF = toFrame(vid.detectForVideo(canvas, ts)) ?? emptyFrame();
    } catch (e) {
      emit(`  frame ${i}: detectForVideo threw: ${e}`);
      vidF = emptyFrame();
    }
    bmp.close();
    imgFrames.push(imgF);
    vidFrames.push(vidF);
    n++;
    const di = isDet(imgF), dv = isDet(vidF);
    if (di) imgDet++;
    if (dv) vidDet++;
    if (di && dv) {
      bothDet++;
      const l = landmarkL2(imgF, vidF);
      meanL2s.push(l.meanL2);
      maxL2s.push(l.maxL2);
      const a = angleDiff(imgF, vidF);
      angMeans.push(a.meanAbs);
      angMaxs.push(a.max);
    } else if (di !== dv) {
      detMismatch++;
    }
    if (i % 20 === 0) setStatus(`${clip} frame ${i}`);
  }
  vid.close();
  emit(`  frames=${n}  IMAGE-detected=${imgDet}  VIDEO-detected=${vidDet}  both=${bothDet}  detection-mismatch=${detMismatch}`);
  emit(`  worldLandmark L2 distance (meters), over both-detected frames:`);
  emit(`    mean-of-33   : mean=${f2(mean(meanL2s))} median=${f2(median(meanL2s))} p95=${f2(pct(meanL2s, 0.95))} max=${f2(Math.max(0, ...meanL2s))}`);
  emit(`    worst-landmk : p95=${f2(pct(maxL2s, 0.95))} max=${f2(Math.max(0, ...maxL2s))}`);
  emit(`  joint-angle difference (degrees), over both-detected frames:`);
  emit(`    mean-of-feats: mean=${f2(mean(angMeans))} median=${f2(median(angMeans))} p95=${f2(pct(angMeans, 0.95))} max=${f2(Math.max(0, ...angMeans))}`);
  emit(`    worst-feature: p95=${f2(pct(angMaxs, 0.95))} max=${f2(Math.max(0, ...angMaxs))}`);
  // Persist VIDEO-mode frames so the Node rubric eval can run on them.
  await postRaw(`frames_${clip}_vid`, { fps: 30, kind: "video", frames: vidFrames });
  flush();
}

/** PHASE 2: reproduce the app's two-call timestamp pattern on ONE landmarker.
 * extractVideo restarts ts near 0 each call; the user pass thus feeds backwards
 * timestamps relative to the landmarker's internal clock. */
async function timestampResetRepro() {
  emit(`\n===== TIMESTAMP-RESET REPRO (mimics runAnalysis pro→user on one cached VIDEO landmarker) =====`);
  await resetLandmarker();
  const vid = await buildVideoLandmarker();

  async function feed(clip: string, label: string, max: number) {
    let lastTs = 0;
    let ok = 0, threw = 0, undetected = 0;
    let firstErr = "";
    for (let i = 1; i <= max; i++) {
      const bmp = await loadBitmap(`/testclips/${clip}/f${String(i).padStart(4, "0")}.jpg`);
      if (!bmp) break;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      // Exactly mirrors extractVideo's ts logic: ts restarts from ~0 each call.
      let ts = Math.round((i - 0.5) * 33.3667);
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      try {
        const r = vid.detectForVideo(canvas, ts);
        const fr = toFrame(r);
        if (fr && isDet(fr)) ok++;
        else undetected++;
      } catch (e) {
        threw++;
        if (!firstErr) firstErr = String((e as Error)?.message ?? e);
      }
      bmp.close();
      setStatus(`${label} frame ${i}`);
    }
    emit(`  ${label} (${clip}): detected=${ok} undetected=${undetected} threw=${threw}${firstErr ? `  firstError="${firstErr}"` : ""}`);
    return { ok, threw, undetected, firstErr };
  }

  emit(`  PASS A = "pro" video (ts ascending from ~16)`);
  // PASS A advances the shared landmarker clock; its result isn't inspected.
  await feed("novak_a", "PASS A (pro)", 80);
  emit(`  PASS B = "user" video on the SAME landmarker (ts RESTARTS from ~16 — the app's bug pattern)`);
  const b = await feed("timo_fh", "PASS B (user)", 80);
  emit(`\n  VERDICT:`);
  if (b.threw > 0) {
    emit(`    ✗ User pass threw ${b.threw} times (e.g. "${b.firstErr}"). The cross-call ts reset IS rejected by MediaPipe → the app's video-pro flow would FAIL on the user video.`);
  } else if (b.ok === 0 && b.undetected > 0) {
    emit(`    ⚠ User pass threw nothing but detected 0 poses — silent degradation from the ts reset.`);
  } else {
    emit(`    ✓ User pass succeeded (detected=${b.ok}, threw=0) despite the ts reset — MediaPipe tolerates it here.`);
  }
  vid.close();
  flush();
}

async function main() {
  emit(`IMAGE-vs-VIDEO mode probe — tasks-vision 0.10.34, heavy model, GPU`);
  setStatus("phase 1: divergence");
  for (const clip of ["novak_fh", "timo_fh", "novak2_fh", "novak_a"]) {
    await divergenceForClip(clip, 160);
  }
  setStatus("phase 2: timestamp reset");
  await timestampResetRepro();
  emit(`\n===== DONE =====`);
  setStatus("DONE");
  flush();
}

window.addEventListener("pagehide", () => { void resetLandmarker(); });

main().catch((e) => {
  setStatus("ERROR");
  emit(`\nERROR: ${e?.stack || e}`);
  flush();
  console.error(e);
});
