export type InferredMediaKind = "image" | "video";

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
