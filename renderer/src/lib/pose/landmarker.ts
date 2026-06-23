import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { PoseFrame, Landmark3D } from "./types";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";

type RunningMode = "IMAGE" | "VIDEO";

/**
 * Cached landmarker instances. "VIDEO_TTA" holds the SECOND instance used for
 * the horizontally-mirrored stream in flip-augmented video detection: VIDEO-
 * mode landmarkers carry temporal tracking state, so the original and mirrored
 * streams must each get their own instance rather than interleaving one.
 * IMAGE-mode detection is stateless, so its mirrored pass reuses the one
 * IMAGE instance.
 */
type InstanceKey = RunningMode | "VIDEO_TTA";

const landmarkers: Partial<Record<InstanceKey, Promise<PoseLandmarker>>> = {};

/**
 * Strictly-increasing timestamp clock for the shared VIDEO-mode landmarker.
 *
 * MediaPipe's `detectForVideo` requires timestamps that increase monotonically
 * across every call to a given landmarker instance — and we cache + reuse one
 * VIDEO landmarker for the whole session (see `getLandmarker`). A single
 * analysis calls `extractVideo` twice: once for the pro clip, once for the
 * user clip. If each clip derived its timestamps from its own local media time
 * (which restarts at ~0), the second clip would feed timestamps that run
 * *backwards* relative to the landmarker's internal clock, and MediaPipe rejects
 * them with "Packet timestamp mismatch", aborting the entire comparison. We
 * therefore offset every clip's timestamps to start just past the previous
 * clip's last one. Reset to 0 whenever the landmarker is torn down.
 */
let videoClock = 0;

async function getLandmarker(
  mode: RunningMode,
  key: InstanceKey = mode,
): Promise<PoseLandmarker> {
  const existing = landmarkers[key];
  if (existing) return existing;
  const p = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: mode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    // Prefer the GPU delegate for speed, but fall back to CPU when a usable
    // WebGL/GPU context can't be created (VMs, remote-desktop sessions, headless
    // or old integrated GPUs, hardware acceleration disabled, driver issues).
    // MediaPipe REJECTS rather than silently downgrading, so without this the
    // whole pipeline — the entire product — fails at the first extract on those
    // machines. The same model + math run on either delegate, so the validated
    // comparison rubric is unaffected; only speed changes.
    try {
      return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (gpuErr) {
      console.warn(
        "MediaPipe GPU delegate unavailable; falling back to CPU (slower).",
        gpuErr,
      );
      return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
  })();
  landmarkers[key] = p;
  // If initialization fails (e.g. a transient network error fetching the WASM
  // runtime or the heavy model), evict the rejected promise so the next analysis
  // re-attempts instead of being permanently stuck with the cached rejection
  // until the app is restarted. The caller still observes this rejection.
  p.catch(() => {
    if (landmarkers[key] === p) delete landmarkers[key];
  });
  return p;
}

export async function resetLandmarker(): Promise<void> {
  for (const key of Object.keys(landmarkers) as InstanceKey[]) {
    const p = landmarkers[key];
    if (!p) continue;
    try {
      const lm = await p;
      lm.close();
    } catch {
      // ignore
    }
    delete landmarkers[key];
  }
  // A freshly-created VIDEO landmarker starts its internal clock at 0, so our
  // monotonic offset must reset alongside it.
  videoClock = 0;
}

function emptyFrame(): PoseFrame {
  const f: PoseFrame = [];
  for (let i = 0; i < 33; i++) f.push({ x: 0, y: 0, z: 0, visibility: 0 });
  return f;
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

// ---------------------------------------------------------------------------
// Flip-augmented detection (test-time augmentation).
//
// BlazePose-family models carry small left/right asymmetric biases and produce
// independent noise per detection. Detecting the SAME frame twice — once as-is
// and once horizontally mirrored — then mapping the mirrored result back and
// merging, cancels the asymmetric bias and reduces single-detection noise at
// the cost of a second inference per frame.
// ---------------------------------------------------------------------------

/** L/R landmark partner table for mapping a mirrored detection back. */
const FLIP_PARTNER: number[] = (() => {
  const pairs: [number, number][] = [
    [1, 4], [2, 5], [3, 6], // eyes (inner/center/outer)
    [7, 8], // ears
    [9, 10], // mouth corners
    [11, 12], // shoulders
    [13, 14], // elbows
    [15, 16], // wrists
    [17, 18], // pinkies
    [19, 20], // indexes
    [21, 22], // thumbs
    [23, 24], // hips
    [25, 26], // knees
    [27, 28], // ankles
    [29, 30], // heels
    [31, 32], // foot indexes
  ];
  const partner = Array.from({ length: 33 }, (_, i) => i);
  for (const [a, b] of pairs) {
    partner[a] = b;
    partner[b] = a;
  }
  return partner;
})();

/**
 * Two same-frame estimates of one landmark agreeing within this distance
 * (meters, world coordinates) are averaged. Beyond it they are treated as a
 * detector disagreement — usually a depth/left-right flip in one of the two —
 * and averaging would fabricate a pose neither detection saw.
 */
const TTA_AGREE_M = 0.15;

/** Map a detection of the mirrored image back into original-image space:
 * negate x and swap each left landmark with its right partner. */
function unmirrorFrame(f: PoseFrame): PoseFrame {
  return f.map((_, i) => {
    const src = f[FLIP_PARTNER[i]];
    return { x: -src.x, y: src.y, z: src.z, visibility: src.visibility };
  });
}

/**
 * Merge the primary detection with the (already unmirrored) flipped detection.
 *  - Agreement: average position and visibility — bias cancellation.
 *  - Disagreement: keep the primary position but report the pair's minimum
 *    visibility, so the downstream cleanup (gap-fill / despike / confidence
 *    weighting) treats the landmark as unreliable instead of trusting a frame
 *    the detector itself can't reproduce under a mirror.
 */
function mergeTta(primary: PoseFrame, flipped: PoseFrame): PoseFrame {
  return primary.map((p, i) => {
    const q = flipped[i];
    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    if (d <= TTA_AGREE_M) {
      return {
        x: (p.x + q.x) / 2,
        y: (p.y + q.y) / 2,
        z: (p.z + q.z) / 2,
        visibility: (p.visibility + q.visibility) / 2,
      };
    }
    return { x: p.x, y: p.y, z: p.z, visibility: Math.min(p.visibility, q.visibility) };
  });
}

/** Lazily-created canvas that holds the horizontally mirrored source frame. */
let flipCanvas: HTMLCanvasElement | null = null;
function mirrorOnCanvas(
  src: HTMLImageElement | HTMLCanvasElement | ImageBitmap | HTMLVideoElement,
  w: number,
  h: number,
): HTMLCanvasElement {
  if (!flipCanvas) flipCanvas = document.createElement("canvas");
  if (flipCanvas.width !== w) flipCanvas.width = w;
  if (flipCanvas.height !== h) flipCanvas.height = h;
  const ctx = flipCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context for TTA mirroring");
  ctx.setTransform(-1, 0, 0, 1, w, 0);
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return flipCanvas;
}

export interface DetectOptions {
  /** Flip-augmented detection: a second inference on the mirrored frame,
   * merged back. Defaults to true (accuracy over speed). */
  tta?: boolean;
}

/** Extract pose landmarks from a still image using an IMAGE-mode landmarker. */
export async function detectImage(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  opts: DetectOptions = {},
): Promise<PoseFrame | null> {
  const lm = await getLandmarker("IMAGE");
  const res = lm.detect(image as unknown as HTMLImageElement);
  const primary = toFrame(res);
  if (opts.tta === false) return primary;
  const w = (image as { width: number }).width;
  const h = (image as { height: number }).height;
  if (!(w > 0) || !(h > 0)) return primary;
  const resF = lm.detect(mirrorOnCanvas(image, w, h) as unknown as HTMLImageElement);
  const flipped = toFrame(resF);
  if (!flipped) return primary;
  const unmirrored = unmirrorFrame(flipped);
  // Primary dropout but the mirrored view detected — recover the frame.
  return primary ? mergeTta(primary, unmirrored) : unmirrored;
}

export interface ExtractionProgress {
  completed: number;
  frame: number;
  totalFrames: number;
}

/** Extract pose landmarks from every sampled frame of a video element. */
export async function extractVideo(
  video: HTMLVideoElement,
  opts: {
    targetFps?: number;
    onProgress?: (p: ExtractionProgress) => void;
    maxFrames?: number;
    /** Abort the (long, serial) extraction loop when the user cancels a run. */
    signal?: AbortSignal;
  } & DetectOptions = {},
): Promise<{ frames: PoseFrame[]; fps: number; duration: number }> {
  const lm = await getLandmarker("VIDEO");
  // Flip-augmented detection: the mirrored stream tracks on its own instance.
  const lmF = opts.tta === false ? null : await getLandmarker("VIDEO", "VIDEO_TTA");
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) {
    throw new Error("Video duration is not available yet — wait for 'loadedmetadata'.");
  }
  const targetFps = opts.targetFps ?? 30;
  const maxFrames = opts.maxFrames ?? 600;

  const total = Math.min(
    maxFrames,
    Math.max(2, Math.floor(duration * targetFps)),
  );
  const fps = total / duration;

  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) {
    // Dimensions come from the metadata, not the duration; a 0×0 canvas would
    // make every detectForVideo run on an empty frame (all zero poses). Guard
    // here so the public API is safe even if a caller only waited for duration.
    throw new Error(
      "Video dimensions are not available yet — wait for 'loadedmetadata'.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D canvas context for frame extraction");

  const frames: PoseFrame[] = [];
  // Continue the shared monotonic clock past the previous clip (see videoClock).
  const base = videoClock;
  let lastTs = base;
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) {
        throw new DOMException("Analysis cancelled", "AbortError");
      }
      const t = (i + 0.5) / total * duration;
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let ts = base + Math.round(t * 1000);
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      const res = lm.detectForVideo(canvas, ts);
      let f = toFrame(res);
      if (lmF) {
        const resF = lmF.detectForVideo(mirrorOnCanvas(canvas, canvas.width, canvas.height), ts);
        const flipped = toFrame(resF);
        if (flipped && f) f = mergeTta(f, unmirrorFrame(flipped));
        // Primary dropout but the mirrored view detected — recover the frame.
        else if (flipped) f = unmirrorFrame(flipped);
      }
      frames.push(f ?? emptyFrame());
      opts.onProgress?.({ completed: (i + 1) / total, frame: i + 1, totalFrames: total });
    }
  } finally {
    // Advance the shared clock so the next clip's timestamps start strictly above
    // the last one we ACTUALLY fed the cached landmarker — even when the loop
    // throws partway (user cancel, seek error). The cached VIDEO instances have
    // already consumed timestamps up to `lastTs`; persisting the clock in a
    // `finally` keeps the next extractVideo monotonic. Without it, a cancelled or
    // failed run leaves videoClock stale (low) while the instance's internal
    // clock is high, so the NEXT analysis feeds backwards-running timestamps and
    // MediaPipe rejects them ("Packet timestamp mismatch"), bricking every
    // subsequent comparison until the app restarts.
    videoClock = lastTs + 1;
  }
  return { frames, fps, duration };
}

/**
 * Internal pieces exposed for the dev validation probes and unit tests ONLY
 * (the TTA merge math is pure and Node-testable; the VIDEO-mode dual-instance
 * path can't be driven through a real <video> in the test environment, so the
 * probe replicates extractVideo's loop against these same internals).
 */
export const __testing = {
  getLandmarker,
  mergeTta,
  unmirrorFrame,
  mirrorOnCanvas,
  TTA_AGREE_M,
};

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const onSeeked = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek error"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.max(0, Math.min(video.duration - 1e-3, t));
  });
}
