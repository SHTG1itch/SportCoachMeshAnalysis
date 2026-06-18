// Dev-only probe: did despiking move the phase anchor (dominant-wrist speed
// peak) to a glitch-free, physically plausible frame? Prints the smoothed
// per-frame speed of the pro's left wrist (novak is left-handed) with and
// without despikeFrames, plus which frames despike altered.
// Run with: REAL_EVAL=1 npx vitest run peakprobe
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fillGaps, despikeFrames, smoothFrames } from "./prepare";
import { normalizeAll } from "./normalize";
import { L, type PoseFrame } from "./types";

const RESULTS = path.resolve(process.cwd(), "harness-results");
let out = "";
const w = (s = "") => { out += s + "\n"; };

function speeds(frames: PoseFrame[], j: number, fps: number): number[] {
  const v: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1][j], b = frames[i][j];
    v.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * fps);
  }
  // ~100ms moving average like detectPhases
  const r = Math.max(1, Math.round(fps * 0.05));
  return v.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const idx = i + k; if (idx >= 0 && idx < v.length) { s += v[idx]; c++; } }
    return s / c;
  });
}

function topPeaks(sp: number[], n: number): string {
  return sp.map((s, i) => [i, s] as [number, number])
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([i, s]) => `f${i}:${s.toFixed(1)}m/s`).join(" ");
}

describe("peak probe", () => {
  it.skipIf(!process.env.REAL_EVAL)("wrist speed peaks pre/post despike", () => {
    const { fps, frames } = JSON.parse(
      fs.readFileSync(path.join(RESULTS, "frames_novak_fh.txt"), "utf8"),
    ) as { fps: number; frames: PoseFrame[] };
    const J = L.LEFT_WRIST;
    const before = smoothFrames(fillGaps(frames));
    const after = smoothFrames(despikeFrames(fillGaps(frames)));
    const spB = speeds(before, J, fps);
    const spA = speeds(after, J, fps);
    w(`fps=${fps.toFixed(2)} frames=${frames.length}`);
    w(`BEFORE despike top peaks: ${topPeaks(spB, 6)}`);
    w(`AFTER  despike top peaks: ${topPeaks(spA, 6)}`);
    // which frames did despike change for the wrist + shoulders?
    const moved: string[] = [];
    const filled = fillGaps(frames);
    const desp = despikeFrames(filled);
    for (const [j, name] of [[L.LEFT_WRIST, "Lwri"], [L.LEFT_SHOULDER, "Lsho"], [L.RIGHT_SHOULDER, "Rsho"], [L.LEFT_ANKLE, "Lank"]] as [number, string][]) {
      for (let i = 0; i < frames.length; i++) {
        const a = filled[i][j], b = desp[i][j];
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (d > 0.05) moved.push(`${name}@f${i}(${d.toFixed(2)}m)`);
      }
    }
    w(`despike moved: ${moved.join(" ")}`);
    // detectPhases actually sees NORMALIZED frames (hip origin, torso scale) —
    // print that speed timeline too, before/after despike.
    const spNB = speeds(normalizeAll(before), J, fps);
    const spNA = speeds(normalizeAll(after), J, fps);
    w(`NORMALIZED before top: ${topPeaks(spNB, 8)}`);
    w(`NORMALIZED after  top: ${topPeaks(spNA, 8)}`);
    const fmt = (sp: number[]) => sp.map((s, i) => (i % 5 === 0 ? `f${i}=${s.toFixed(1)}` : s.toFixed(1))).join(" ");
    w(`NORMALIZED before timeline: ${fmt(spNB)}`);
    w(`NORMALIZED after  timeline: ${fmt(spNA)}`);
    fs.writeFileSync(path.join(RESULTS, "peakprobe.txt"), out);
    // eslint-disable-next-line no-console
    console.log(out);
  });
});
