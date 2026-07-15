import { describe, expect, it } from "vitest";
import { inferMediaKind } from "./media";

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
