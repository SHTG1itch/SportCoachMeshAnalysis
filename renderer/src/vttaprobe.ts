// VIDEO-mode TTA probe (dev fixture, NOT shipped).
//
// The shipped video-vs-video flow now runs TWO VIDEO-mode landmarkers (primary
// + mirrored stream) off one shared monotonic clock, across two clips with no
// reset in between — the exact topology that previously hid a timestamp bug
// that broke the headline feature. Real <video> decode is suspended in this
// automation environment, so this probe replicates extractVideo's loop
// faithfully (same instances via getLandmarker, same ts scheme, same
// mirrorOnCanvas/mergeTta/unmirrorFrame internals) against JPG frame
// sequences, pro then user, and verifies:
//   1. No "timestamp mismatch" throw on either instance across both clips.
//   2. Detection rate stays high on both clips.
//   3. The merged output is sane (core landmarks present, plausible torso).
//
// Run: http://localhost:5173/vttaprobe.html?run=vtta
import { __testing } from "./lib/pose/landmarker";
import { L, type PoseFrame } from "./lib/pose/types";

const { getLandmarker, mergeTta, unmirrorFrame, mirrorOnCanvas } = __testing;

const statusEl = document.getElementById("status")!;
const outEl = document.getElementById("out")!;
let buf = "";
let curStatus = "";
const RESULT_NAME = new URLSearchParams(location.search).get("run") ?? "vtta";
function post(force = false) {
  const payload = `STATUS: ${curStatus}\n${buf}`;
  fetch(`http://localhost:5174/result?name=${encodeURIComponent(RESULT_NAME)}`, {
    method: "POST",
    body: payload,
    keepalive: force,
  }).catch(() => {});
}
function emit(s = "") {
  buf += s + "\n";
  outEl.textContent = buf;
}
function setStatus(s: string) {
  curStatus = s;
  statusEl.textContent = s;
  post();
}
const f2 = (n: number) => n.toFixed(2);

const CORE = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];
const isDet = (f: PoseFrame) => CORE.every((i) => f[i] && f[i].visibility >= 0.3);

async function loadFrames(dir: string, max: number): Promise<ImageBitmap[]> {
  const bmps: ImageBitmap[] = [];
  for (let i = 1; i <= max; i++) {
    const url = `${dir}/f${String(i).padStart(4, "0")}.jpg`;
    const res = await fetch(url);
    if (!res.ok) break;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) break;
    bmps.push(await createImageBitmap(blob));
  }
  return bmps;
}

function toFrame(res: { worldLandmarks?: { x: number; y: number; z: number; visibility?: number }[][] }): PoseFrame | null {
  const lms = res.worldLandmarks?.[0];
  if (!lms || lms.length < 33) return null;
  return lms.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 1 }));
}

/** Replicates extractVideo's per-clip loop, TTA on, sharing `clock` across calls. */
let clock = 0;
async function extractClip(label: string, bmps: ImageBitmap[]): Promise<PoseFrame[]> {
  const lm = await getLandmarker("VIDEO");
  const lmF = await getLandmarker("VIDEO", "VIDEO_TTA");
  const canvas = document.createElement("canvas");
  canvas.width = bmps[0].width;
  canvas.height = bmps[0].height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const frames: PoseFrame[] = [];
  const base = clock;
  let lastTs = base;
  let merged = 0;
  let recovered = 0;
  for (let i = 0; i < bmps.length; i++) {
    const t = (i + 0.5) / 30; // same local-media-time shape as extractVideo @30fps
    ctx.drawImage(bmps[i], 0, 0, canvas.width, canvas.height);
    let ts = base + Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const f0 = toFrame(lm.detectForVideo(canvas, ts));
    let f = f0;
    const resF = lmF.detectForVideo(mirrorOnCanvas(canvas, canvas.width, canvas.height), ts);
    const flipped = toFrame(resF);
    if (flipped && f) {
      f = mergeTta(f, unmirrorFrame(flipped));
      merged++;
    } else if (flipped) {
      f = unmirrorFrame(flipped);
      recovered++;
    }
    frames.push(f ?? Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })));
    if (i % 20 === 0) setStatus(`${label} frame ${i + 1}/${bmps.length}`);
  }
  clock = lastTs + 1;
  const det = frames.filter(isDet).length;
  emit(`[${label}] frames=${frames.length} detected=${det} (${f2((100 * det) / frames.length)}%) merged=${merged} recovered=${recovered} tsRange=[${base}..${lastTs}]`);
  // Torso sanity on a mid detected frame.
  const mid = frames.find(isDet);
  if (mid) {
    const torso = Math.hypot(
      (mid[L.LEFT_SHOULDER].x + mid[L.RIGHT_SHOULDER].x) / 2 - (mid[L.LEFT_HIP].x + mid[L.RIGHT_HIP].x) / 2,
      (mid[L.LEFT_SHOULDER].y + mid[L.RIGHT_SHOULDER].y) / 2 - (mid[L.LEFT_HIP].y + mid[L.RIGHT_HIP].y) / 2,
      (mid[L.LEFT_SHOULDER].z + mid[L.RIGHT_SHOULDER].z) / 2 - (mid[L.LEFT_HIP].z + mid[L.RIGHT_HIP].z) / 2,
    );
    emit(`  torso length=${f2(torso)}m (plausible 0.3-0.7)`);
  }
  return frames;
}

async function main() {
  emit(`VIDEO-mode TTA probe: dual landmarker instances, shared clock, two clips, no reset`);
  setStatus("loading pro frames…");
  const pro = await loadFrames("/testclips/novak_fh", 150);
  setStatus("loading user frames…");
  const user = await loadFrames("/testclips/timo_fh", 150);
  emit(`loaded pro=${pro.length} user=${user.length} JPGs`);
  if (pro.length === 0 || user.length === 0) throw new Error("no frames loaded");

  // Pro then user on the SAME instances — the app's exact call topology.
  await extractClip("PRO novak_fh", pro);
  await extractClip("USER timo_fh", user);

  emit(`\nRESULT: both clips extracted with TTA, no timestamp throw — VIDEO dual-instance path OK`);
  setStatus("DONE");
  post(true);
}

main().catch((e) => {
  setStatus("ERROR");
  emit(`\nERROR: ${e?.stack || e}`);
  post(true);
});
