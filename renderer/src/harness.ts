// Browser validation harness — runs the REAL analysis pipeline on local clips
// served by Vite, then dumps coordinate-convention diagnostics, the full report,
// the coaching guide/workouts, and self-consistency checks. Loaded in Chrome via
// Claude-in-Chrome so we can validate accuracy on real tennis footage.
//
// NOT part of the shipped app — a developer test fixture only.

import { detectImage, resetLandmarker } from "./lib/pose/landmarker";
import { compare } from "./lib/pose/compare";
import { generateGuideAndWorkouts } from "./lib/coach";
import { computeAngles, JOINT_FEATURES } from "./lib/pose/angles";
import { L, type PoseFrame } from "./lib/pose/types";
import { findSport } from "./lib/sports";
import type { SportMeta } from "@shared/types";

const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";

// Mirror all output to a local results server so it can be read from disk,
// independent of the (flaky) browser extension connection.
const RESULT_NAME = new URLSearchParams(location.search).get("run") ?? "live";
let postTimer: number | null = null;
function postResults(force = false) {
  const send = () => {
    postTimer = null;
    const payload = `STATUS: ${curStatus}\n${buf}`;
    fetch(`http://localhost:5174/result?name=${encodeURIComponent(RESULT_NAME)}`, {
      method: "POST",
      body: payload,
      keepalive: true,
    }).catch(() => {});
  };
  if (force) {
    if (postTimer) clearTimeout(postTimer);
    send();
  } else if (postTimer === null) {
    postTimer = window.setTimeout(send, 400);
  }
}
function emit(s = "") {
  buf += s + "\n";
  outEl.textContent = buf;
  postResults();
}
function setStatus(s: string) {
  curStatus = s;
  statusEl.textContent = s;
  postResults();
}
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

const qs = new URLSearchParams(location.search);
const PRO = qs.get("pro") ?? "/testclips/novak_a";
const USER = qs.get("user") ?? "/testclips/amateur_a";
const SPORT_ID = qs.get("sport") ?? "tennis";
const SHOT = qs.get("shot") ?? "Forehand";
const PRO_KIND = (qs.get("proKind") ?? "video") as "video" | "image";
const MAX_FRAMES = Number(qs.get("maxFrames") ?? 240);
const SELFTEST = qs.get("selftest") === "1";

const log = (...a: unknown[]) => {
  console.log("[HARNESS]", ...a);
  emit("· " + a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));
};

function clipName(url: string): string {
  return (url.split("/").pop() ?? "clip").replace(/\.[^.]+$/, "");
}

/** Directory of extracted JPGs for a clip: strip any trailing file extension. */
function framesDir(url: string): string {
  return url.replace(/\.[a-z0-9]+$/i, "");
}

/** Persist a JSON object to the results server (read from disk in Node). */
async function postRaw(name: string, obj: unknown): Promise<void> {
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const body = JSON.stringify(obj, (_k, v) => (typeof v === "number" ? round(v) : v));
  try {
    // No keepalive: it caps the body at 64KB and the frames JSON is larger.
    await fetch(`http://localhost:5174/result?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body,
    });
    log(`saved ${name} (${body.length} bytes)`);
  } catch (e) {
    log(`save ${name} failed: ${e}`);
  }
}

function emptyFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 0 });
  return f;
}

/**
 * Extract pose frames from a directory of JPGs (f0001.jpg, f0002.jpg, …) using
 * MediaPipe IMAGE-mode detection. Used instead of <video> decode because
 * background browser tabs suspend the video pipeline, whereas createImageBitmap
 * + synchronous WASM/GL detection runs regardless of tab visibility.
 */
async function extractImageSeq(dir: string, label: string, max: number): Promise<PoseFrame[]> {
  const frames: PoseFrame[] = [];
  for (let i = 1; i <= max; i++) {
    const url = `${dir}/f${String(i).padStart(4, "0")}.jpg`;
    const res = await fetch(url);
    if (!res.ok) break;
    const blob = await res.blob();
    // Vite's SPA fallback returns 200 + index.html for missing files — treat any
    // non-image response as the end of the sequence.
    if (!blob.type.startsWith("image/")) break;
    const bmp = await createImageBitmap(blob);
    const fr = await detectImage(bmp);
    bmp.close();
    frames.push(fr ?? emptyFrame());
    if (i % 10 === 0 || i === 1) setStatus(`${label} frame ${i}`);
  }
  return frames;
}

async function detectSingleImage(url: string): Promise<PoseFrame> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const fr = await detectImage(bmp);
  bmp.close();
  if (!fr) throw new Error(`no pose detected in ${url}`);
  return fr;
}

const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
function isDetected(f: PoseFrame): boolean {
  return CORE.every((i) => f[i] && f[i].visibility >= 0.3);
}
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mid = (a: number, b: number) => (a + b) / 2;

/** Coordinate-convention + angle-sanity diagnostics from RAW (pre-normalize) frames. */
function conventionDiag(label: string, frames: PoseFrame[]) {
  const det = frames.filter(isDetected);
  emit(`\n[${label}] ${frames.length} frames, ${det.length} detected (${f2((100 * det.length) / Math.max(1, frames.length))}%)`);
  if (det.length === 0) {
    emit(`  (no detected frames — cannot diagnose)`);
    return;
  }
  const dyShoulderHip = det.map(
    (f) => mid(f[L.LEFT_SHOULDER].y, f[L.RIGHT_SHOULDER].y) - mid(f[L.LEFT_HIP].y, f[L.RIGHT_HIP].y),
  );
  const dyHipAnkle = det.map(
    (f) => mid(f[L.LEFT_HIP].y, f[L.RIGHT_HIP].y) - mid(f[L.LEFT_ANKLE].y, f[L.RIGHT_ANKLE].y),
  );
  const medShoulderHipDy = median(dyShoulderHip);
  emit(`  median(shoulderMid.y - hipMid.y) = ${f2(medShoulderHipDy)}  ${medShoulderHipDy > 0 ? "(+ ⇒ shoulders ABOVE hips at +y ⇒ y-UP)" : "(- ⇒ shoulders ABOVE hips at -y ⇒ y-DOWN)"}`);
  emit(`  median(hipMid.y - ankleMid.y)    = ${f2(median(dyHipAnkle))}`);
  // Sample one mid detected frame's raw world coords.
  const sample = det[Math.floor(det.length / 2)];
  const show = (name: string, i: number) =>
    emit(`    ${name.padEnd(14)} x=${f2(sample[i].x)} y=${f2(sample[i].y)} z=${f2(sample[i].z)} vis=${f2(sample[i].visibility)}`);
  emit(`  sample mid-frame raw world landmarks:`);
  show("NOSE", L.NOSE);
  show("L_SHOULDER", L.LEFT_SHOULDER);
  show("R_SHOULDER", L.RIGHT_SHOULDER);
  show("L_HIP", L.LEFT_HIP);
  show("R_HIP", L.RIGHT_HIP);
  show("L_ANKLE", L.LEFT_ANKLE);
  show("R_ANKLE", L.RIGHT_ANKLE);
  // Mean of every angle feature over detected frames (angles are scale/translation invariant).
  const sums = new Array(JOINT_FEATURES.length).fill(0);
  for (const f of det) {
    const a = computeAngles(f);
    for (let i = 0; i < a.length; i++) sums[i] += a[i];
  }
  emit(`  mean angle features over detected frames:`);
  JOINT_FEATURES.forEach((jf, i) => {
    const v = sums[i] / det.length;
    let flag = "";
    if (jf.name === "trunk_lean") {
      flag = v < 30 ? "  ✓ upright≈0 ⇒ y-UP & gravity-aligned" : v > 150 ? "  ⚠ ≈180 ⇒ y-DOWN (sign flip)" : "  ⚠ mid ⇒ NOT gravity-aligned / leaning";
    }
    if (jf.name === "shoulder_line_tilt") flag = v < 25 ? "  ✓ near-level" : "  ⚠ large tilt";
    emit(`    ${jf.name.padEnd(20)} ${f2(v).padStart(8)}°${flag}`);
  });
}

// Geometric sagittal mirror: negate x and swap L/R landmark indices.
const MIRROR_PAIRS: [number, number][] = [
  [L.LEFT_SHOULDER, L.RIGHT_SHOULDER],
  [L.LEFT_ELBOW, L.RIGHT_ELBOW],
  [L.LEFT_WRIST, L.RIGHT_WRIST],
  [L.LEFT_HIP, L.RIGHT_HIP],
  [L.LEFT_KNEE, L.RIGHT_KNEE],
  [L.LEFT_ANKLE, L.RIGHT_ANKLE],
  [L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX],
  [L.LEFT_HEEL, L.RIGHT_HEEL],
  [L.LEFT_EYE, L.RIGHT_EYE],
  [L.LEFT_EAR, L.RIGHT_EAR],
];
function mirrorFrame(f: PoseFrame): PoseFrame {
  const partner = new Map<number, number>();
  for (const [a, b] of MIRROR_PAIRS) {
    partner.set(a, b);
    partner.set(b, a);
  }
  return f.map((_, i) => {
    const src = f[partner.get(i) ?? i];
    return { x: -src.x, y: src.y, z: src.z, visibility: src.visibility };
  });
}

function dumpReport(label: string, sport: SportMeta, proFrames: PoseFrame[], proFps: number, proKind: "image" | "video", userFrames: PoseFrame[], userFps: number) {
  const report = compare({
    sport,
    shot: SHOT,
    pro: { frames: proFrames, fps: proFps, kind: proKind },
    user: { frames: userFrames, fps: userFps },
  });
  emit(`\n========== COMPARE: ${label} ==========`);
  emit(`mode=${report.mode}  overallSimilarity=${f2(report.overallSimilarity)}  handedness=${JSON.stringify(report.handedness)}`);
  emit(`coverage=${JSON.stringify(report.coverage)}  proFrames=${report.proFrameCount} userFrames=${report.userFrameCount}`);
  if (report.alignment) emit(`dtw.distance=${f2(report.alignment.distance)}`);
  emit(`\njoint deltas (sorted by impact):`);
  emit(`  ${"joint".padEnd(20)} ${"mean".padStart(7)} ${"max".padStart(7)} ${"pro".padStart(7)} ${"user".padStart(7)} ${"bias".padStart(7)}  sig`);
  for (const d of report.jointDeltas) {
    emit(`  ${d.joint.padEnd(20)} ${f2(d.meanDeltaDeg).padStart(7)} ${f2(d.maxDeltaDeg).padStart(7)} ${f2(d.proMeanDeg).padStart(7)} ${f2(d.userMeanDeg).padStart(7)} ${f2(d.signedBiasDeg).padStart(7)}  ${d.significance}`);
  }
  emit(`\nphases:`);
  for (const p of report.phases) {
    emit(`  ${p.name.padEnd(16)} [${p.startFrame}-${p.endFrame}]  top: ${p.topDeltas.map((t) => `${t.joint} Δ${f2(t.meanDeltaDeg)}`).join(", ")}`);
  }
  const gw = generateGuideAndWorkouts({
    sport,
    shot: SHOT,
    numericReport: {
      overallSimilarity: report.overallSimilarity,
      jointDeltas: report.jointDeltas,
      phases: report.phases,
      mode: report.mode,
      handedness: report.handedness,
    },
  });
  emit(`\n--- GUIDE ---`);
  emit(`summary: ${gw.guide.summary}`);
  emit(`strengths: ${gw.guide.strengths.join(" | ")}`);
  emit(`cues: ${gw.guide.cues.join(" | ")}`);
  gw.guide.keyIssues.forEach((k, i) => {
    emit(`  issue${i + 1}: ${k.title}`);
    emit(`    observation: ${k.observation}`);
    emit(`    cause: ${k.cause}`);
    emit(`    fix: ${k.fix}`);
  });
  emit(`\n--- WORKOUTS ---`);
  gw.workouts.forEach((w) => {
    emit(`  [${w.title}] ${w.difficulty} ${w.durationMin}min  targets=${w.targetsJoints.join(",")}`);
    emit(`    focus: ${w.focus}`);
    emit(`    main: ${w.main.map((s) => s.name).join(" | ")}`);
    if (w.notes) emit(`    notes: ${w.notes}`);
  });
  return report;
}

async function main() {
  emit(`Harness config: pro=${PRO} user=${USER} sport=${SPORT_ID} shot=${SHOT} proKind=${PRO_KIND} maxFrames=${MAX_FRAMES} selftest=${SELFTEST}`);
  const sport = findSport(SPORT_ID) ?? findSport("tennis")!;

  // --- Pro ---
  let proFrames: PoseFrame[];
  let proFps: number;
  if (PRO_KIND === "image") {
    setStatus("detecting pro image…");
    proFrames = [await detectSingleImage(PRO)];
    proFps = 1;
  } else {
    setStatus("extracting pro pose…");
    proFrames = await extractImageSeq(framesDir(PRO), "pro", MAX_FRAMES);
    proFps = 30;
  }
  log(`pro frames: ${proFrames.length}`);

  // --- User ---
  setStatus("extracting user pose…");
  const userFrames = await extractImageSeq(framesDir(USER), "user", MAX_FRAMES);
  const userFps = 30;
  log(`user frames: ${userFrames.length}`);
  if (proFrames.length === 0 || userFrames.length === 0) throw new Error("no frames extracted");

  // Persist raw extracted landmarks so the math can be iterated on in Node
  // (decoupled from browser/extension flakiness).
  await postRaw(`frames_${clipName(PRO)}`, { fps: proFps, kind: PRO_KIND, frames: proFrames });
  await postRaw(`frames_${clipName(USER)}`, { fps: userFps, kind: "video", frames: userFrames });

  emit(`\n###### COORDINATE-CONVENTION & ANGLE-SANITY DIAGNOSTICS ######`);
  conventionDiag("PRO " + PRO, proFrames);
  conventionDiag("USER " + USER, userFrames);

  // --- Main comparison ---
  dumpReport("PRO vs USER", sport, proFrames, proFps, PRO_KIND, userFrames, userFps);

  // --- Self-consistency ---
  if (SELFTEST && PRO_KIND === "video") {
    emit(`\n###### SELF-CONSISTENCY ######`);
    dumpReport("PRO vs PRO (expect ~1.0)", sport, proFrames, proFps, "video", proFrames.map((f) => f.map((l) => ({ ...l }))), proFps);
    dumpReport("PRO vs MIRROR(PRO) (expect ~1.0, mirrored=true)", sport, proFrames, proFps, "video", proFrames.map(mirrorFrame), proFps);
  }

  emit(`\n###### DONE ######`);
  setStatus("DONE");
  postResults(true);
}

// Free MediaPipe's WebGL context when the tab reloads/closes so repeated runs
// in the same tab don't leak GPU contexts (which can starve video decoding).
window.addEventListener("pagehide", () => { void resetLandmarker(); });

main().catch((e) => {
  setStatus("ERROR");
  emit(`\nERROR: ${e?.stack || e}`);
  postResults(true);
  console.error(e);
});
