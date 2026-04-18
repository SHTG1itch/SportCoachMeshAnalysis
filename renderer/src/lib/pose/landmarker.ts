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
  let lastTs = 0;
  for (let i = 0; i < total; i++) {
    const t = (i + 0.5) / total * duration;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let ts = Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const res = lm.detectForVideo(canvas, ts);
    const f = toFrame(res);
    frames.push(f ?? emptyFrame());
    opts.onProgress?.({ completed: (i + 1) / total, frame: i + 1, totalFrames: total });
  }
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
