import { describe, expect, it } from "vitest";
import {
  inferMediaKind,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  validateDecodedMedia,
  validateMediaFile,
} from "./media";

describe("inferMediaKind", () => {
  it("prefers a supplied MIME type", () => {
    expect(inferMediaKind({ name: "reference.bin", type: "image/png" })).toBe("image");
    expect(inferMediaKind({ name: "reference.jpg", type: "video/mp4" })).toBe("video");
  });

  it("falls back to a case-insensitive extension for OS drag sources", () => {
    expect(inferMediaKind({ name: "PRO-POSE.JPEG", type: "" })).toBe("image");
    expect(inferMediaKind({ name: "swing.MOV", type: "" })).toBe("video");
  });

  it("leaves genuinely unknown files for the media loader to reject", () => {
    expect(inferMediaKind({ name: "clip", type: "" })).toBeNull();
    expect(inferMediaKind({ name: "clip.xyz", type: "application/octet-stream" })).toBeNull();
  });
});

describe("validateMediaFile", () => {
  it("accepts supported media within the configured limits", () => {
    expect(
      validateMediaFile({ name: "pose.jpg", type: "", size: 1024 }, "image"),
    ).toBeNull();
    expect(
      validateMediaFile({ name: "swing.mp4", type: "video/mp4", size: 1024 }, "video"),
    ).toBeNull();
  });

  it("rejects unknown, empty, mismatched, and oversized files", () => {
    expect(validateMediaFile({ name: "mystery", type: "", size: 10 }, "video"))
      .toContain("isn't supported");
    expect(validateMediaFile({ name: "empty.mp4", type: "video/mp4", size: 0 }, "video"))
      .toContain("empty");
    expect(validateMediaFile({ name: "pose.png", type: "image/png", size: 10 }, "video"))
      .toContain("isn't a video");
    expect(
      validateMediaFile(
        { name: "huge.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 },
        "image-or-video",
      ),
    ).toContain("too large");
    expect(
      validateMediaFile(
        { name: "huge.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES + 1 },
        "image-or-video",
      ),
    ).toContain("too large");
  });
});

describe("validateDecodedMedia", () => {
  it("accepts normal image and video metadata", () => {
    expect(validateDecodedMedia("image", 4032, 3024)).toBeNull();
    expect(validateDecodedMedia("video", 3840, 2160, 20)).toBeNull();
  });

  it("rejects invalid dimensions, unsafe resolutions, and long videos", () => {
    expect(validateDecodedMedia("image", 0, 100)).toContain("dimensions");
    expect(validateDecodedMedia("image", 10_000, 10_000)).toContain("resolution");
    expect(validateDecodedMedia("video", 7680, 4320, 10)).toContain("resolution");
    expect(validateDecodedMedia("video", 1920, 1080, 61)).toContain("60 seconds");
  });
});
