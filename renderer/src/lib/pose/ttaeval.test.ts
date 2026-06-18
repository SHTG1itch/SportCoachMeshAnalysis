// Dev-only measurement: does flip-augmented detection (TTA) improve raw
// landmark quality and preserve the validated comparison rubric?
// Compares the standard fixtures (frames_<clip>.txt) against TTA extractions
// of the SAME JPG frames (frames_<clip>_tta.txt, captured via the browser
// harness with tta=1). Writes harness-results/ttaeval.txt.
// Run with: REAL_EVAL=1 npx vitest run ttaeval
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./compare";
import { fillGaps } from "./prepare";
import { L, type PoseFrame } from "./types";
import type { SportMeta } from "@shared/types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
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

let out = "";
const w = (s = "") => { out += s + "\n"; };
const f2 = (n: number) => n.toFixed(2);

const TRACKED = [
  L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_ELBOW, L.RIGHT_ELBOW,
  L.LEFT_WRIST, L.RIGHT_WRIST, L.LEFT_HIP, L.RIGHT_HIP,
  L.LEFT_KNEE, L.RIGHT_KNEE, L.LEFT_ANKLE, L.RIGHT_ANKLE,
];

/** Count physically implausible spike-and-return landmark jumps (same
 * criterion as the despike probe: >0.12 m off the neighbour midpoint while the
 * neighbours agree). Measures RAW extraction quality, before any cleanup. */
function spikeCount(frames: PoseFrame[]): number {
  const filled = fillGaps(frames);
  let n = 0;
  for (const j of TRACKED) {
    for (let i = 1; i < filled.length - 1; i++) {
      const prev = filled[i - 1][j], cur = filled[i][j], next = filled[i + 1][j];
      const dev = Math.hypot(
        cur.x - (prev.x + next.x) / 2,
        cur.y - (prev.y + next.y) / 2,
        cur.z - (prev.z + next.z) / 2,
      );
      const span = Math.hypot(prev.x - next.x, prev.y - next.y, prev.z - next.z);
      if (dev > 0.12 && dev > 1.5 * span) n++;
    }
  }
  return n;
}

/** Mean frame-to-frame jitter (m) of tracked landmarks — lower = less noise. */
function meanJitter(frames: PoseFrame[]): number {
  const filled = fillGaps(frames);
  let s = 0, c = 0;
  for (const j of TRACKED) {
    for (let i = 1; i < filled.length; i++) {
      const a = filled[i - 1][j], b = filled[i][j];
      s += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      c++;
    }
  }
  return c ? s / c : 0;
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

function rubricLine(label: string, pro: { fps: number; frames: PoseFrame[] }, user: { fps: number; frames: PoseFrame[] }): string {
  const r = compare({
    sport: TENNIS, shot: "Forehand",
    pro: { frames: pro.frames, fps: pro.fps, kind: "video" },
    user: { frames: user.frames, fps: user.fps },
  });
  const high = r.jointDeltas.filter((d) => d.significance === "high").length;
  const med = r.jointDeltas.filter((d) => d.significance === "medium").length;
  const noise = r.jointDeltas.reduce((s, d) => s + d.meanDeltaDeg, 0) / r.jointDeltas.length;
  return `${label.padEnd(10)} sim=${f2(r.overallSimilarity)} high=${high} med=${med} meanAbsΔ(avg over joints)=${f2(noise)}° mirrored=${r.handedness?.mirrored}`;
}

describe("tta evaluation", () => {
  const ENABLED = !!process.env.REAL_EVAL;
  const have = ENABLED && ["novak_fh", "timo_fh", "novak_fh_tta", "timo_fh_tta"].every(
    (n) => fs.existsSync(path.join(RESULTS, `frames_${n}.txt`)),
  );
  it.skipIf(!have)("standard vs TTA extraction", () => {
    w(`===== RAW EXTRACTION QUALITY (lower is better) =====`);
    for (const clip of ["novak_fh", "timo_fh", "novak2_fh", "novak_a"]) {
      const std = load(clip);
      const tta = load(`${clip}_tta`);
      if (!std || !tta) { w(`${clip}: missing fixture, skipped`); continue; }
      w(`${clip.padEnd(10)} spikes std=${spikeCount(std.frames)} tta=${spikeCount(tta.frames)}   jitter std=${(1000 * meanJitter(std.frames)).toFixed(1)}mm tta=${(1000 * meanJitter(tta.frames)).toFixed(1)}mm`);
    }

    w(`\n===== RUBRIC: standard extraction =====`);
    const nov = load("novak_fh")!;
    const timo = load("timo_fh")!;
    w(rubricLine("SELF", nov, { fps: nov.fps, frames: nov.frames.map((f) => f.map((l) => ({ ...l }))) }));
    w(rubricLine("MIRROR", nov, { fps: nov.fps, frames: mirror(nov.frames) }));
    w(rubricLine("REAL", nov, timo));
    const nov2 = load("novak2_fh");
    if (nov2) w(rubricLine("CAL", nov, nov2));

    w(`\n===== RUBRIC: TTA extraction =====`);
    const novT = load("novak_fh_tta")!;
    const timoT = load("timo_fh_tta")!;
    w(rubricLine("SELF", novT, { fps: novT.fps, frames: novT.frames.map((f) => f.map((l) => ({ ...l }))) }));
    w(rubricLine("MIRROR", novT, { fps: novT.fps, frames: mirror(novT.frames) }));
    w(rubricLine("REAL", novT, timoT));
    const nov2T = load("novak2_fh_tta");
    if (nov2T) w(rubricLine("CAL", novT, nov2T));

    // Per-joint detail for the REAL comparison under both extractions, so a
    // changed flag can be traced to its bias movement.
    const detail = (label: string, pro: { fps: number; frames: PoseFrame[] }, user: { fps: number; frames: PoseFrame[] }) => {
      const r = compare({
        sport: TENNIS, shot: "Forehand",
        pro: { frames: pro.frames, fps: pro.fps, kind: "video" },
        user: { frames: user.frames, fps: user.fps },
      });
      w(`\n--- REAL detail (${label}) ---`);
      for (const d of r.jointDeltas)
        w(`  ${d.joint.padEnd(20)} bias=${f2(d.signedBiasDeg).padStart(7)} mean=${f2(d.meanDeltaDeg).padStart(7)}  ${d.significance}`);
    };
    detail("std", nov, timo);
    detail("tta", novT, timoT);

    fs.writeFileSync(path.join(RESULTS, "ttaeval.txt"), out);
    // eslint-disable-next-line no-console
    console.log(out);
  });
});
