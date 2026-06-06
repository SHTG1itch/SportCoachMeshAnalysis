import type {
  AnalysisRecord,
  AnalysisReport,
  SportMeta,
} from "@shared/types";
import type { PoseFrame } from "./pose/types";
import { compare } from "./pose/compare";
import { generateGuideAndWorkouts } from "./coach";
import {
  detectImage,
  extractVideo,
  type ExtractionProgress,
} from "./pose/landmarker";

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
}

export async function runAnalysis(
  input: AnalyzeInput,
  onProgress: (p: AnalyzeProgress) => void,
): Promise<AnalysisReport> {
  const proMedia = await loadMedia(input.proFile, input.proKind);
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
      onProgress: (p: ExtractionProgress) =>
        onProgress({
          stage: "extracting_pro",
          message: `Extracting pro pose — frame ${p.frame}/${p.totalFrames}`,
          progress: 0.1 + p.completed * 0.3,
        }),
    });
    proFrames = result.frames;
    proFps = result.fps;
  }

  onProgress({
    stage: "loading_user",
    message: "Loading your video…",
    progress: 0.4,
  });
  const userMedia = await loadMedia(input.userFile, "video");
  const userResult = await extractVideo(userMedia.video!, {
    targetFps: 30,
    onProgress: (p: ExtractionProgress) =>
      onProgress({
        stage: "extracting_user",
        message: `Extracting your pose — frame ${p.frame}/${p.totalFrames}`,
        progress: 0.4 + p.completed * 0.45,
      }),
  });

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

  // Release media element resources.
  proMedia.cleanup();
  userMedia.cleanup();

  onProgress({ stage: "done", message: "Analysis complete", progress: 1 });
  return report;
}

interface LoadedMedia {
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  cleanup: () => void;
}

async function loadMedia(file: File, kind: "image" | "video"): Promise<LoadedMedia> {
  const url = URL.createObjectURL(file);
  if (kind === "image") {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image failed to load"));
    });
    return {
      image,
      cleanup: () => URL.revokeObjectURL(url),
    };
  }
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Video failed to load"));
  });
  // Ensure videoWidth/Height are set (needed for canvas sizing).
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    await new Promise<void>((resolve) => {
      const h = () => {
        video.removeEventListener("loadedmetadata", h);
        resolve();
      };
      video.addEventListener("loadedmetadata", h);
    });
  }
  return {
    video,
    cleanup: () => URL.revokeObjectURL(url),
  };
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
