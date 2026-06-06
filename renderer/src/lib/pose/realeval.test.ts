// Real-data evaluation harness (NOT a unit test — a measurement tool).
//
// Reads pose frames captured from real tennis footage by the browser harness
// (saved under ../../../../harness-results/) and runs the actual compare + coach
// pipeline on them, writing a formatted diagnostic report to
// harness-results/eval.txt. Lets the comparison math be iterated in Node,
// decoupled from the (flaky) browser/extension extraction step.
//
// Self-skips when the fixture files are absent (e.g. CI), so it is inert in the
// normal suite. Run explicitly with:  npx vitest run realeval
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./compare";
import { computeAngles, computeAnglesSequence, JOINT_FEATURES } from "./angles";
import { generateGuideAndWorkouts } from "../coach";
import { L, type PoseFrame } from "./types";
import type { SportMeta } from "@shared/types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
const load = (name: string): { fps: number; kind: string; frames: PoseFrame[] } | null => {
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

let out = "";
const w = (s = "") => {
  out += s + "\n";
};
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
const isDet = (f: PoseFrame) => CORE.every((i) => f[i] && f[i].visibility >= 0.3);

function diag(label: string, frames: PoseFrame[]) {
  const det = frames.filter(isDet);
  w(`\n[${label}] ${frames.length} frames, ${det.length} detected (${f2((100 * det.length) / Math.max(1, frames.length))}%)`);
  if (!det.length) return;
  // mean visibility of wrists/elbows/ankles (data quality)
  const meanVis = (i: number) => det.reduce((s, fr) => s + fr[i].visibility, 0) / det.length;
  w(`  vis: Rwrist=${f2(meanVis(L.RIGHT_WRIST))} Lwrist=${f2(meanVis(L.LEFT_WRIST))} Relbow=${f2(meanVis(L.RIGHT_ELBOW))} Rankle=${f2(meanVis(L.RIGHT_ANKLE))}`);
  const sums = new Array(JOINT_FEATURES.length).fill(0);
  for (const fr of det) {
    const a = computeAngles(fr);
    for (let i = 0; i < a.length; i++) sums[i] += a[i];
  }
  // also with sequence (clip-aware) computation
  const seq = computeAnglesSequence(frames);
  const seqSums = new Array(JOINT_FEATURES.length).fill(0);
  let seqN = 0;
  frames.forEach((fr, k) => {
    if (!isDet(fr)) return;
    seqN++;
    for (let i = 0; i < JOINT_FEATURES.length; i++) seqSums[i] += seq[k][i];
  });
  w(`  mean angles (per-frame computeAngles | clip-aware computeAnglesSequence):`);
  JOINT_FEATURES.forEach((jf, i) => {
    w(`    ${jf.name.padEnd(20)} ${f2(sums[i] / det.length).padStart(8)} | ${f2(seqSums[i] / Math.max(1, seqN)).padStart(8)}`);
  });
}

const MIRROR_PAIRS: [number, number][] = [
  [L.LEFT_SHOULDER, L.RIGHT_SHOULDER], [L.LEFT_ELBOW, L.RIGHT_ELBOW], [L.LEFT_WRIST, L.RIGHT_WRIST],
  [L.LEFT_HIP, L.RIGHT_HIP], [L.LEFT_KNEE, L.RIGHT_KNEE], [L.LEFT_ANKLE, L.RIGHT_ANKLE],
  [L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX], [L.LEFT_HEEL, L.RIGHT_HEEL], [L.LEFT_EYE, L.RIGHT_EYE], [L.LEFT_EAR, L.RIGHT_EAR],
];
function mirror(frames: PoseFrame[]): PoseFrame[] {
  const partner = new Map<number, number>();
  for (const [a, b] of MIRROR_PAIRS) { partner.set(a, b); partner.set(b, a); }
  return frames.map((f) => f.map((_, i) => { const s = f[partner.get(i) ?? i]; return { x: -s.x, y: s.y, z: s.z, visibility: s.visibility }; }));
}

function report(label: string, proF: PoseFrame[], proFps: number, userF: PoseFrame[], userFps: number) {
  const r = compare({ sport: TENNIS, shot: "Forehand", pro: { frames: proF, fps: proFps, kind: "video" }, user: { frames: userF, fps: userFps } });
  w(`\n========== ${label} ==========`);
  w(`mode=${r.mode} similarity=${f2(r.overallSimilarity)} handedness=${JSON.stringify(r.handedness)} dtw=${r.alignment ? f2(r.alignment.distance) : "-"} cov=${JSON.stringify(r.coverage)}`);
  w(`  ${"joint".padEnd(20)}${"mean".padStart(8)}${"max".padStart(8)}${"pro".padStart(8)}${"user".padStart(8)}${"bias".padStart(8)}  sig`);
  for (const d of r.jointDeltas)
    w(`  ${d.joint.padEnd(20)}${f2(d.meanDeltaDeg).padStart(8)}${f2(d.maxDeltaDeg).padStart(8)}${f2(d.proMeanDeg).padStart(8)}${f2(d.userMeanDeg).padStart(8)}${f2(d.signedBiasDeg).padStart(8)}  ${d.significance}`);
  const highCount = r.jointDeltas.filter((d) => d.significance === "high").length;
  w(`  → ${highCount} high, ${r.jointDeltas.filter((d) => d.significance === "medium").length} medium`);
  w(`  phases:`);
  for (const p of r.phases) w(`    ${p.name.padEnd(15)}[${p.startFrame}-${p.endFrame}] top: ${p.topDeltas.slice(0, 3).map((t) => `${t.joint} Δ${f2(t.meanDeltaDeg)}`).join(", ")}`);
  const gw = generateGuideAndWorkouts({ sport: TENNIS, shot: "Forehand", numericReport: { overallSimilarity: r.overallSimilarity, jointDeltas: r.jointDeltas, phases: r.phases, mode: r.mode, handedness: r.handedness } });
  w(`  GUIDE: ${gw.guide.summary}`);
  gw.guide.keyIssues.forEach((k, i) => w(`    #${i + 1} ${k.title} — ${k.fix}`));
  w(`  cues: ${gw.guide.cues.join(" | ")}`);
  gw.workouts.forEach((wo) => w(`    [${wo.title}] ${wo.difficulty} — main: ${wo.main.map((s) => s.name).join(", ")}`));
  return r;
}

// Dev-only validation harness — skipped in the normal suite. Run with:
//   REAL_EVAL=1 npx vitest run realeval
const ENABLED = !!process.env.REAL_EVAL;
describe("real-data evaluation", () => {
  const novak = ENABLED ? load("novak_fh") : null;
  const timo = ENABLED ? load("timo_fh") : null;
  it.skipIf(!novak || !timo)("novak vs timo forehand", () => {
    diag("PRO novak_fh", novak!.frames);
    diag("USER timo_fh", timo!.frames);
    report("SELF: novak vs novak (expect ~1.0)", novak!.frames, novak!.fps, novak!.frames.map((f) => f.map((l) => ({ ...l }))), novak!.fps);
    report("MIRROR: novak vs mirror(novak) (expect ~1.0, mirrored)", novak!.frames, novak!.fps, mirror(novak!.frames), novak!.fps);
    report("REAL: novak(pro) vs timo(user)", novak!.frames, novak!.fps, timo!.frames, timo!.fps);
    const novak2 = load("novak2_fh");
    if (novak2) report("CALIBRATION: novak(pro) vs novak2 (different pro stroke — expect HIGH)", novak!.frames, novak!.fps, novak2.frames, novak2.fps);
    fs.writeFileSync(path.join(RESULTS, "eval.txt"), out);
    // eslint-disable-next-line no-console
    console.log(out);
  });
});
