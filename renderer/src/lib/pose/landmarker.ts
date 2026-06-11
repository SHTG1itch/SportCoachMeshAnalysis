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

const landmarkers: Partial<Record<RunningMode, Promise<PoseLandmarker>>> = {};

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

async function getLandmarker(mode: RunningMode): Promise<PoseLandmarker> {
  const existing = landmarkers[mode];
  if (existing) return existing;
  const p = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    return await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: mode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  })();
  landmarkers[mode] = p;
  // If initialization fails (e.g. a transient network error fetching the WASM
  // runtime or the heavy model), evict the rejected promise so the next analysis
  // re-attempts instead of being permanently stuck with the cached rejection
  // until the app is restarted. The caller still observes this rejection.
  p.catch(() => {
    if (landmarkers[mode] === p) delete landmarkers[mode];
  });
  return p;
}

export async function resetLandmarker(): Promise<void> {
  for (const key of Object.keys(landmarkers) as RunningMode[]) {
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

/** Extract pose landmarks from a still image using an IMAGE-mode landmarker. */
export async function detectImage(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<PoseFrame | null> {
  const lm = await getLandmarker("IMAGE");
  const res = lm.detect(image as unknown as HTMLImageElement);
  return toFrame(res);
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
  } = {},
): Promise<{ frames: PoseFrame[]; fps: number; duration: number }> {
  const lm = await getLandmarker("VIDEO");
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

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D canvas context for frame extraction");

  const frames: PoseFrame[] = [];
  // Continue the shared monotonic clock past the previous clip (see videoClock).
  const base = videoClock;
  let lastTs = base;
  for (let i = 0; i < total; i++) {
    const t = (i + 0.5) / total * duration;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let ts = base + Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const res = lm.detectForVideo(canvas, ts);
    const f = toFrame(res);
    frames.push(f ?? emptyFrame());
    opts.onProgress?.({ completed: (i + 1) / total, frame: i + 1, totalFrames: total });
  }
  // Advance the shared clock so the next clip's timestamps start strictly above
  // this clip's last one.
  videoClock = lastTs + 1;
  return { frames, fps, duration };
}

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
