// Dev-only measurement probe (NOT a unit test): quantifies residual
// single-frame "spike-and-return" glitches in the real captured footage, at
// two levels:
//   1. RAW landmark trajectories (before any cleanup) — where a despike filter
//      would run if inserted between fillGaps and smoothFrames.
//   2. The angle sequences exactly as compare() computes them today
//      (fillGaps → smooth → normalize → angles → repairImplausibleFrames) —
//      what still leaks through the current pipeline.
// Run with: REAL_EVAL=1 npx vitest run spikeprobe
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fillGaps, despikeFrames, smoothFrames } from "./prepare";
import { normalizeAll } from "./normalize";
import { computeAnglesSequence, JOINT_FEATURES } from "./angles";
import { repairImplausibleFrames } from "./compare";
import { L, type PoseFrame } from "./types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
const load = (name: string): { fps: number; frames: PoseFrame[] } | null => {
  const p = path.join(RESULTS, `frames_${name}.txt`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

let out = "";
const w = (s = "") => { out += s + "\n"; };
const f2 = (n: number) => n.toFixed(2);

const TRACKED = [
  L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_ELBOW, L.RIGHT_ELBOW,
  L.LEFT_WRIST, L.RIGHT_WRIST, L.LEFT_HIP, L.RIGHT_HIP,
  L.LEFT_KNEE, L.RIGHT_KNEE, L.LEFT_ANKLE, L.RIGHT_ANKLE,
] as const;
const NAME: Record<number, string> = {
  [L.LEFT_SHOULDER]: "Lsho", [L.RIGHT_SHOULDER]: "Rsho",
  [L.LEFT_ELBOW]: "Lelb", [L.RIGHT_ELBOW]: "Relb",
  [L.LEFT_WRIST]: "Lwri", [L.RIGHT_WRIST]: "Rwri",
  [L.LEFT_HIP]: "Lhip", [L.RIGHT_HIP]: "Rhip",
  [L.LEFT_KNEE]: "Lkne", [L.RIGHT_KNEE]: "Rkne",
  [L.LEFT_ANKLE]: "Lank", [L.RIGHT_ANKLE]: "Rank",
};

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Landmark-level: spike = point far from the midpoint of its temporal
// neighbours while the neighbours agree with each other.
function landmarkSpikes(label: string, frames: PoseFrame[]) {
  w(`\n[${label}] landmark spike-and-return (gap-filled, pre-smoothing; world meters)`);
  const filled = fillGaps(frames);
  const counts: Record<string, { n: number; maxDev: number; visSum: number }> = {};
  for (const j of TRACKED) {
    counts[NAME[j]] = { n: 0, maxDev: 0, visSum: 0 };
    for (let i = 1; i < filled.length - 1; i++) {
      const prev = filled[i - 1][j], cur = filled[i][j], next = filled[i + 1][j];
      const mid = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2, z: (prev.z + next.z) / 2 };
      const dev = dist(cur, mid);
      const span = dist(prev, next);
      // neighbours agree (span small vs deviation) and deviation is physically big
      if (dev > 0.12 && dev > 1.5 * span) {
        counts[NAME[j]].n++;
        counts[NAME[j]].maxDev = Math.max(counts[NAME[j]].maxDev, dev);
        counts[NAME[j]].visSum += frames[i][j].visibility;
      }
    }
  }
  const total = Object.values(counts).reduce((s, c) => s + c.n, 0);
  w(`  total=${total} over ${filled.length} frames x ${TRACKED.length} landmarks`);
  for (const [name, c] of Object.entries(counts)) {
    if (c.n > 0) w(`    ${name}: n=${c.n} maxDev=${f2(c.maxDev)}m meanVisAtSpike=${f2(c.visSum / c.n)}`);
  }
}

// Angle-level: what compare() actually sees today after its full cleanup.
function angleSpikes(label: string, frames: PoseFrame[]) {
  const cleaned = normalizeAll(smoothFrames(despikeFrames(fillGaps(frames))));
  const seq = repairImplausibleFrames(computeAnglesSequence(cleaned));
  w(`\n[${label}] angle spike-and-return AFTER current pipeline (degrees)`);
  for (let f = 0; f < JOINT_FEATURES.length; f++) {
    let n20 = 0, n30 = 0, maxDev = 0; const examples: string[] = [];
    for (let i = 1; i < seq.length - 1; i++) {
      const dev = Math.abs(seq[i][f] - (seq[i - 1][f] + seq[i + 1][f]) / 2);
      const span = Math.abs(seq[i + 1][f] - seq[i - 1][f]);
      if (dev > 20 && dev > 1.5 * span) {
        n20++;
        if (dev > 30) { n30++; if (examples.length < 4) examples.push(`f${i}:${f2(dev)}°`); }
        maxDev = Math.max(maxDev, dev);
      }
    }
    if (n20 > 0)
      w(`    ${JOINT_FEATURES[f].name.padEnd(20)} n>20°=${n20} n>30°=${n30} max=${f2(maxDev)}°  ${examples.join(" ")}`);
  }
}

const ENABLED = !!process.env.REAL_EVAL;
describe("spike probe", () => {
  const clips = ["novak_fh", "timo_fh", "novak2_fh", "novak_a"];
  it.skipIf(!ENABLED)("measure residual glitches", () => {
    for (const name of clips) {
      const c = load(name);
      if (!c) continue;
      landmarkSpikes(name, c.frames);
      angleSpikes(name, c.frames);
    }
    fs.writeFileSync(path.join(RESULTS, "spikeprobe.txt"), out);
    // eslint-disable-next-line no-console
    console.log(out);
  });
});
