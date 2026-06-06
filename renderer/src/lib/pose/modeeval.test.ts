// IMAGE-vs-VIDEO rubric equivalence eval (NOT a unit test — a measurement tool).
//
// The shipped app extracts poses via MediaPipe VIDEO mode; the validation harness
// used IMAGE mode. This eval proves the documented accuracy rubric
//   - clip vs itself        ≈ 100%
//   - clip vs mirror        ≈ 100% with mirrored=true
//   - same-player > amateur
//   - different pro stroke   => HIGH differences (calibration)
// holds IDENTICALLY whether the frames were extracted in IMAGE mode
// (frames_<clip>.txt) or VIDEO mode (frames_<clip>_vid.txt, produced by the
// browser modeprobe). It loads both frame sets, runs the real compare()+coach on
// each, and prints them side by side, then asserts the qualitative rubric agrees.
//
// Self-skips when the VIDEO-mode fixtures are absent. Run with:
//   REAL_EVAL=1 npx vitest run modeeval
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { compare } from "./compare";
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
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : String(n));

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

interface Metrics {
  self: number;
  mirror: number;
  mirrorFlag: boolean;
  real: number;
  realHigh: number;
  realMed: number;
  realHand: string;
  calib: number | null;
  calibHigh: number | null;
}

function rubric(novak: PoseFrame[], novakFps: number, timo: PoseFrame[], timoFps: number, novak2: PoseFrame[] | null, novak2Fps: number): Metrics {
  const cmp = (pf: PoseFrame[], pfps: number, uf: PoseFrame[], ufps: number) =>
    compare({ sport: TENNIS, shot: "Forehand", pro: { frames: pf, fps: pfps, kind: "video" }, user: { frames: uf, fps: ufps } });
  const self = cmp(novak, novakFps, novak.map((f) => f.map((l) => ({ ...l }))), novakFps);
  const mir = cmp(novak, novakFps, mirror(novak), novakFps);
  const real = cmp(novak, novakFps, timo, timoFps);
  const calib = novak2 ? cmp(novak, novakFps, novak2, novak2Fps) : null;
  return {
    self: self.overallSimilarity,
    mirror: mir.overallSimilarity,
    mirrorFlag: !!mir.handedness?.mirrored,
    real: real.overallSimilarity,
    realHigh: real.jointDeltas.filter((d) => d.significance === "high").length,
    realMed: real.jointDeltas.filter((d) => d.significance === "medium").length,
    realHand: JSON.stringify(real.handedness),
    calib: calib ? calib.overallSimilarity : null,
    calibHigh: calib ? calib.jointDeltas.filter((d) => d.significance === "high").length : null,
  };
}

const ENABLED = !!process.env.REAL_EVAL;
describe("IMAGE vs VIDEO rubric equivalence", () => {
  const imgN = ENABLED ? load("novak_fh") : null;
  const imgT = ENABLED ? load("timo_fh") : null;
  const vidN = ENABLED ? load("novak_fh_vid") : null;
  const vidT = ENABLED ? load("timo_fh_vid") : null;

  it.skipIf(!imgN || !imgT || !vidN || !vidT)("rubric holds under both extraction modes", () => {
    const imgN2 = load("novak2_fh");
    const vidN2 = load("novak2_fh_vid");
    const img = rubric(imgN!.frames, imgN!.fps, imgT!.frames, imgT!.fps, imgN2?.frames ?? null, imgN2?.fps ?? 30);
    const vid = rubric(vidN!.frames, vidN!.fps, vidT!.frames, vidT!.fps, vidN2?.frames ?? null, vidN2?.fps ?? 30);

    const row = (label: string, a: string | number, b: string | number) =>
      w(`  ${label.padEnd(28)} IMAGE=${String(a).padStart(10)}   VIDEO=${String(b).padStart(10)}`);
    w(`\n========== RUBRIC: IMAGE-mode vs VIDEO-mode extraction ==========`);
    row("SELF novak vs novak (~1.0)", f2(img.self), f2(vid.self));
    row("MIRROR sim (~1.0)", f2(img.mirror), f2(vid.mirror));
    row("MIRROR mirrored flag (true)", String(img.mirrorFlag), String(vid.mirrorFlag));
    row("REAL novak vs timo sim", f2(img.real), f2(vid.real));
    row("REAL #high / #medium", `${img.realHigh}/${img.realMed}`, `${vid.realHigh}/${vid.realMed}`);
    row("REAL handedness", img.realHand, vid.realHand);
    if (img.calib !== null) {
      row("CALIB novak vs novak2 sim", f2(img.calib), f2(vid.calib!));
      row("CALIB #high (expect HIGH)", String(img.calibHigh), String(vid.calibHigh));
    }
    w(`\n  SELF > REAL (technique signal preserved): IMAGE ${img.self > img.real} | VIDEO ${vid.self > vid.real}`);
    fs.writeFileSync(path.join(RESULTS, "modeeval.txt"), out);
    // eslint-disable-next-line no-console
    console.log(out);

    // Qualitative rubric must hold under BOTH modes.
    for (const m of [img, vid]) {
      expect(m.self).toBeGreaterThan(0.9);   // clip vs itself ≈ 100%
      expect(m.mirror).toBeGreaterThan(0.9); // clip vs mirror ≈ 100%
      expect(m.mirrorFlag).toBe(true);       // mirror detected
      expect(m.self).toBeGreaterThan(m.real); // same-player > amateur
    }
    // The two modes must agree on the headline similarity within a small margin.
    expect(Math.abs(img.self - vid.self)).toBeLessThan(0.05);
    expect(Math.abs(img.real - vid.real)).toBeLessThan(0.15);
  });
});
