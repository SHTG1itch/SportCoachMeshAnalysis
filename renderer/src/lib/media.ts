export type InferredMediaKind = "image" | "video";
export type MediaAccept = "image" | "video" | "image-or-video";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 60;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_VIDEO_PIXELS = 10_000_000;

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const VIDEO_EXTENSIONS = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
]);

/** Infer a dropped file's media kind even when the OS supplies no MIME type.
 * Chromium ultimately decides codec support when the element loads; this only
 * prevents a known image extension from being sent through the video loader. */
export function inferMediaKind(file: Pick<File, "name" | "type">): InferredMediaKind | null {
  const mime = file.type.trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";

  const dot = file.name.lastIndexOf(".");
  if (dot < 0 || dot === file.name.length - 1) return null;
  const extension = file.name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Fast validation performed before a local file reaches an image/video
 * decoder. The browser accept filter does not apply to drag/drop, MIME types are
 * often blank on Windows, and huge files can otherwise tie up the renderer. */
export function validateMediaFile(
  file: Pick<File, "name" | "type" | "size">,
  accept: MediaAccept,
): string | null {
  const kind = inferMediaKind(file);
  if (!kind) {
    return "That file type isn't supported. Choose a standard image or video file.";
  }
  if (accept === "image" && kind !== "image") {
    return "That file isn't an image. Please choose an image file.";
  }
  if (accept === "video" && kind !== "video") {
    return "That file isn't a video. Please choose a video file.";
  }
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "That file is empty or unreadable.";
  }
  if (file.size > maxBytes) {
    return `That ${kind} is too large. Choose one under ${formatLimit(maxBytes)}.`;
  }
  return null;
}

/** Validate decoded metadata before allocating pose-extraction canvases. */
export function validateDecodedMedia(
  kind: InferredMediaKind,
  width: number,
  height: number,
  durationSeconds?: number,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return `The ${kind} dimensions are not available.`;
  }
  const pixels = width * height;
  const maxPixels = kind === "image" ? MAX_IMAGE_PIXELS : MAX_VIDEO_PIXELS;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    return `The ${kind} resolution is too large to analyze safely.`;
  }
  if (kind === "video") {
    if (
      durationSeconds === undefined ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      return "The video duration is not available.";
    }
    if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      return `The video is too long. Trim it to ${MAX_VIDEO_DURATION_SECONDS} seconds or less.`;
    }
  }
  return null;
}
