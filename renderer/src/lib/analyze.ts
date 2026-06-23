import type {
  AnalysisRecord,
  AnalysisReport,
  SportMeta,
} from "@shared/types";
import type { PoseFrame } from "./pose/types";
import { L } from "./pose/types";
import { compare } from "./pose/compare";
import { detectionCoverage } from "./pose/prepare";
import { generateGuideAndWorkouts } from "./coach";
import {
  detectImage,
  extractVideo,
  type ExtractionProgress,
} from "./pose/landmarker";

/** Core torso landmarks — if none of these is ever detected, no person was
 * found in the clip. */
const CORE_LANDMARKS = [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP];

/** Throw a clear, user-facing error when a video yielded zero detected poses.
 * Without this, extractVideo returns all-zero frames and compare() produces a
 * confident-looking but meaningless report (the image path already guards this
 * way; the video path did not). */
function assertPoseDetected(frames: PoseFrame[], who: string): void {
  if (detectionCoverage(frames, CORE_LANDMARKS) <= 0) {
    throw new Error(
      `Could not detect a pose in ${who}. Make sure the full body is visible, well-lit, and in frame.`,
    );
  }
}

function abortError(): DOMException {
  return new DOMException("Analysis cancelled", "AbortError");
}

export type AnalyzeStage =
  | "loading_pro"
  | "extracting_pro"
  | "loading_user"
  | "extracting_user"
  | "comparing"
  | "generating_guide"
  | "done";

export interface AnalyzeProgress {
  stage: AnalyzeStage;
  message: string;
  /** 0..1 overall. */
  progress: number;
}

export interface AnalyzeInput {
  sport: SportMeta;
  shot: string;
  proFile: File;
  userFile: File;
  proKind: "image" | "video";
  /** Aborts the (potentially multi-minute) extraction when the user cancels. */
  signal?: AbortSignal;
}

export async function runAnalysis(
  input: AnalyzeInput,
  onProgress: (p: AnalyzeProgress) => void,
): Promise<AnalysisReport> {
  // Hold the media handles outside the try so the finally can revoke their object
  // URLs on BOTH the success path and any throw between here and the end — e.g.
  // the "Could not detect a pose" throw below, or an extractVideo/WASM failure.
  // Without this, every failed run leaks a blob URL (and its backing media
  // buffer) for the rest of the renderer session.
  let proMedia: LoadedMedia | undefined;
  let userMedia: LoadedMedia | undefined;
  try {
    proMedia = await loadMedia(input.proFile, input.proKind, input.signal);
    onProgress({
      stage: "loading_pro",
      message: `Loaded ${input.proKind === "image" ? "image" : "video"} of the pro`,
      progress: 0.05,
    });

    let proFrames: PoseFrame[];
    let proFps: number;
    if (input.proKind === "image") {
      onProgress({
        stage: "extracting_pro",
        message: "Detecting pose in pro image…",
        progress: 0.1,
      });
      const frame = await detectImage(proMedia.image!);
      if (!frame) {
        throw new Error(
          "Could not detect a pose in the pro image. Try a clearer image where the full body is visible.",
        );
      }
      proFrames = [frame];
      proFps = 1;
    } else {
      const result = await extractVideo(proMedia.video!, {
        targetFps: 30,
        signal: input.signal,
        onProgress: (p: ExtractionProgress) =>
          onProgress({
            stage: "extracting_pro",
            message: `Extracting pro pose — frame ${p.frame}/${p.totalFrames}`,
            progress: 0.1 + p.completed * 0.3,
          }),
      });
      proFrames = result.frames;
      proFps = result.fps;
      assertPoseDetected(proFrames, "the pro video");
    }

    onProgress({
      stage: "loading_user",
      message: "Loading your video…",
      progress: 0.4,
    });
    userMedia = await loadMedia(input.userFile, "video", input.signal);
    const userResult = await extractVideo(userMedia.video!, {
      targetFps: 30,
      signal: input.signal,
      onProgress: (p: ExtractionProgress) =>
        onProgress({
          stage: "extracting_user",
          message: `Extracting your pose — frame ${p.frame}/${p.totalFrames}`,
          progress: 0.4 + p.completed * 0.45,
        }),
    });

    assertPoseDetected(userResult.frames, "your video");

    onProgress({
      stage: "comparing",
      message: "Comparing mechanics frame-by-frame…",
      progress: 0.88,
    });

    const report = compare({
      sport: input.sport,
      shot: input.shot,
      pro: { frames: proFrames, fps: proFps, kind: input.proKind },
      user: { frames: userResult.frames, fps: userResult.fps },
    });

    onProgress({
      stage: "generating_guide",
      message: "Generating coaching guide and workouts…",
      progress: 0.92,
    });

    // Computed natively on-device — no API key, no network call. This is a pure,
    // synchronous function over the numeric report, so it always succeeds; the
    // guarded call is defense-in-depth only (a thrown error here would be a
    // deterministic bug, surfaced by the unit tests, not a transient failure).
    try {
      const res = generateGuideAndWorkouts({
        sport: input.sport,
        shot: input.shot,
        numericReport: {
          overallSimilarity: report.overallSimilarity,
          jointDeltas: report.jointDeltas,
          phases: report.phases,
          mode: report.mode,
          handedness: report.handedness,
        },
      });
      report.guide = res.guide;
      report.workouts = res.workouts;
    } catch (e) {
      console.error("Guide generation failed:", e);
      // Leave guide null / workouts empty; the result screen offers a manual
      // re-generate button (which also persists the result).
    }

    onProgress({ stage: "done", message: "Analysis complete", progress: 1 });
    return report;
  } finally {
    // Release media element resources (revoke object URLs) on every exit path.
    proMedia?.cleanup();
    userMedia?.cleanup();
  }
}

interface LoadedMedia {
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  cleanup: () => void;
}

/**
 * Resolve when `el` fires `okEvent`, reject on "error" or when `signal` aborts.
 * Listeners are always removed, so a cancel during a slow decode is honored
 * immediately rather than after the load finally settles.
 */
function awaitMediaEvent(
  el: HTMLMediaElement | HTMLImageElement,
  okEvent: string,
  errMsg: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const cleanup = () => {
      el.removeEventListener(okEvent, onOk);
      el.removeEventListener("error", onErr);
      signal?.removeEventListener("abort", onAbort);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(errMsg));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    el.addEventListener(okEvent, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadMedia(
  file: File,
  kind: "image" | "video",
  signal?: AbortSignal,
): Promise<LoadedMedia> {
  const url = URL.createObjectURL(file);
  // Revoke the blob URL on ANY failure (load error, abort) — otherwise a failed
  // load leaks the URL and its backing media buffer for the renderer session,
  // since the caller never receives a `cleanup` handle to revoke it.
  try {
    if (kind === "image") {
      const image = new Image();
      image.src = url;
      await awaitMediaEvent(image, "load", "Image failed to load", signal);
      return { image, cleanup: () => URL.revokeObjectURL(url) };
    }
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await awaitMediaEvent(video, "loadeddata", "Video failed to load", signal);
    // Ensure videoWidth/Height are set (needed for canvas sizing).
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      await awaitMediaEvent(video, "loadedmetadata", "Video metadata failed to load", signal);
    }
    return { video, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export function buildRecord(
  report: AnalysisReport,
  thumbnailDataUrl: string | undefined,
): AnalysisRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sportId: report.sport.id,
    shot: report.shot,
    thumbnailDataUrl,
    report,
  };
}
