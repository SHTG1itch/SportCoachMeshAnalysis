import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "@shared/security";

const packagedEntryUrl = "file:///C:/Program%20Files/SportCoach/resources/app.asar/dist/index.html";

describe("isTrustedRendererUrl", () => {
  it("accepts only the exact packaged entry document", () => {
    const options = {
      isPackaged: true,
      packagedEntryUrl,
      developmentOrigin: "http://localhost:5173",
    };
    expect(isTrustedRendererUrl(packagedEntryUrl, options)).toBe(true);
    expect(isTrustedRendererUrl(`${packagedEntryUrl}?spoof=1`, options)).toBe(false);
    expect(isTrustedRendererUrl("file:///C:/Users/Public/dropped.html", options)).toBe(false);
  });

  it("uses an exact parsed origin in development", () => {
    const options = {
      isPackaged: false,
      packagedEntryUrl,
      developmentOrigin: "http://localhost:5173",
    };
    expect(isTrustedRendererUrl("http://localhost:5173/", options)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173/src/main.tsx", options)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173.evil.test/", options)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5174/", options)).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(
      isTrustedRendererUrl("not a url", {
        isPackaged: true,
        packagedEntryUrl,
        developmentOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
  });
});
