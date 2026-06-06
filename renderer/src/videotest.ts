// Real <video> extraction + timestamp-fix verification (dev-only fixture).
//
// Part 1 (flake-free, canvas): replicates the FIXED extractVideo timestamp
// scheme — a shared monotonic clock continued across two passes on ONE cached
// VIDEO landmarker — and confirms MediaPipe accepts it (the buggy restart-from-0
// scheme threw "Packet timestamp mismatch" 80/80 in modeprobe).
//
// Part 2 (real <video>): runs the ACTUAL fixed runAnalysis(proKind="video") on
// real .mp4 files, exercising the full decode → seek → canvas → detectForVideo
// path twice (pro then user) on the cached landmarker. Proves both that the fix
// holds in the real code AND that the <video> extraction path runs.
//
// Background tabs throttle <video> decode (documented env limitation); keep this
// tab foreground. Results POST to :5174 so they are readable from disk.

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { resetLandmarker } from "./lib/pose/landmarker";
import { runAnalysis, type AnalyzeProgress } from "./lib/analyze";
import { findSport } from "./lib/sports";
import { L, type PoseFrame } from "./lib/pose/types";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";

const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";
function post() {
  fetch(`http://localhost:5174/result?name=videotest`, {
    method: "POST",
    body: `STATUS: ${curStatus}\n${buf}`,
  }).catch(() => {});
}
let pending: number | null = null;
function emit(s = "") {
  buf += s + "\n";
  outEl.textContent = buf;
  if (pending === null) pending = window.setTimeout(() => { pending = null; post(); }, 300);
}
function setStatus(s: string) { curStatus = s; statusEl.textContent = s; }
function flush() { if (pending) { clearTimeout(pending); pending = null; } post(); }

const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
const isDet = (f: PoseFrame) => CORE.every((i) => f[i] && f[i].visibility >= 0.3);
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));

function toFrame(r: PoseLandmarkerResult): PoseFrame | null {
  if (!r.worldLandmarks?.length) return null;
  const lms = r.worldLandmarks[0];
  if (!lms || lms.length < 33) return null;
  return Array.from({ length: 33 }, (_, i) => ({
    x: lms[i].x, y: lms[i].y, z: lms[i].z,
    visibility: (lms[i] as { visibility?: number }).visibility ?? 1,
  }));
}

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null;
  return createImageBitmap(blob);
}

// ---------- Part 1: flake-free replica of the FIXED timestamp scheme ----------
async function part1Fixed() {
  emit(`===== PART 1: fixed monotonic-clock scheme (canvas, no <video>) =====`);
  await resetLandmarker();
  const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
  const vid = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let clock = 0; // shared monotonic clock (mirrors landmarker.ts videoClock)

  async function feed(clip: string, label: string, max: number) {
    const base = clock;
    let lastTs = base;
    let ok = 0, threw = 0, undet = 0, firstErr = "";
    for (let i = 1; i <= max; i++) {
      const bmp = await loadBitmap(`/testclips/${clip}/f${String(i).padStart(4, "0")}.jpg`);
      if (!bmp) break;
      canvas.width = bmp.width; canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      let ts = base + Math.round((i - 0.5) * 33.3667); // FIX: offset past previous clip
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      try {
        const fr = toFrame(vid.detectForVideo(canvas, ts));
        if (fr && isDet(fr)) ok++; else undet++;
      } catch (e) { threw++; if (!firstErr) firstErr = String((e as Error)?.message ?? e); }
      bmp.close();
      setStatus(`P1 ${label} frame ${i}`);
    }
    clock = lastTs + 1;
    emit(`  ${label} (${clip}): detected=${ok} undetected=${undet} threw=${threw}${firstErr ? ` firstErr="${firstErr.slice(0, 80)}"` : ""}`);
    return threw;
  }

  emit(`  PASS A "pro" (clock from 0)`);
  await feed("novak_a", "PASS A", 40);
  emit(`  PASS B "user" on SAME landmarker (clock CONTINUED — the fix)`);
  const threwB = await feed("timo_fh", "PASS B", 40);
  emit(`  VERDICT: ${threwB === 0 ? "✓ fixed scheme accepted by MediaPipe (no throws on the user pass)" : `✗ still threw ${threwB} times`}`);
  vid.close();
  flush();
}

// ---------- Part 2: real runAnalysis on actual <video> files ----------
async function fileFromUrl(url: string, name: string, type: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return new File([await res.blob()], name, { type });
}

async function part2RealVideo() {
  emit(`\n===== PART 2: real runAnalysis(proKind="video") on <video> decode =====`);
  await resetLandmarker(); // start clean; the app shares one landmarker across pro+user
  const sport = findSport("tennis")!;
  const proFile = await fileFromUrl("/testclips/novak_a.mp4", "pro.mp4", "video/mp4");
  const userFile = await fileFromUrl("/testclips/raw_timo.mp4", "user.mp4", "video/mp4");
  emit(`  pro=novak_a.mp4 (${proFile.size}B)  user=raw_timo.mp4 (${userFile.size}B)`);

  let lastProgress = Date.now();
  let lastMsg = "";
  const onProgress = (p: AnalyzeProgress) => {
    lastProgress = Date.now();
    if (p.message !== lastMsg) { lastMsg = p.message; }
    setStatus(`P2 ${(p.progress * 100).toFixed(0)}% ${p.message}`);
  };
  // Watchdog: report if no progress for 25s (likely a <video>-decode throttle stall).
  const watch = window.setInterval(() => {
    const idle = (Date.now() - lastProgress) / 1000;
    if (idle > 25) emit(`  ⚠ watchdog: no progress for ${idle.toFixed(0)}s (last: "${lastMsg}") — possible <video> decode throttle`);
  }, 10000);

  try {
    const t0 = Date.now();
    const report = await runAnalysis({ sport, shot: "Forehand", proFile, userFile, proKind: "video" }, onProgress);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    emit(`  ✓ runAnalysis COMPLETED in ${secs}s`);
    emit(`    mode=${report.mode} proFrames=${report.proFrameCount} userFrames=${report.userFrameCount}`);
    emit(`    overallSimilarity=${f2(report.overallSimilarity)} coverage=${JSON.stringify(report.coverage)} handedness=${JSON.stringify(report.handedness)}`);
    emit(`    phases=${report.phases.length} guide=${!!report.guide} workouts=${report.workouts.length}`);
    emit(`    top deltas: ${report.jointDeltas.slice(0, 3).map((d) => `${d.joint} bias${f2(d.signedBiasDeg)}(${d.significance})`).join(", ")}`);
    emit(`  → The video-pro → video-user flow works end-to-end with the timestamp fix.`);
  } catch (e) {
    emit(`  ✗ runAnalysis THREW: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
  } finally {
    clearInterval(watch);
    flush();
  }
}

async function main() {
  setStatus("part 1");
  await part1Fixed();
  setStatus("part 2");
  await part2RealVideo();
  emit(`\n===== DONE =====`);
  setStatus("DONE");
  flush();
}

window.addEventListener("pagehide", () => { void resetLandmarker(); });
main().catch((e) => { setStatus("ERROR"); emit(`\nERROR: ${e?.stack || e}`); flush(); console.error(e); });
