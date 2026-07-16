import { describe, expect, it } from "vitest";
import sequenceRecord from "../public/sample_seq.json";
import singleRecord from "../public/sample_single.json";
import {
  isAnalysisReport,
  isIsoTimestamp,
  isRasterImageDataUrl,
  isTheme,
  isWorkout,
} from "@shared/validation";
import type { AnalysisRecord } from "@shared/types";

const sequence = sequenceRecord as unknown as AnalysisRecord;
const single = singleRecord as unknown as AnalysisRecord;

describe("persistence runtime validation", () => {
  it("accepts both real saved-report fixtures", () => {
    expect(isAnalysisReport(sequence.report)).toBe(true);
    expect(isAnalysisReport(single.report)).toBe(true);
  });

  it("rejects a report with a malformed nested joint", () => {
    const report = structuredClone(sequence.report) as unknown as Record<string, unknown>;
    const deltas = report.jointDeltas as Record<string, unknown>[];
    deltas[0].meanDeltaDeg = "not a number";
    expect(isAnalysisReport(report)).toBe(false);
  });

  it("rejects non-finite values before they can be persisted", () => {
    const report = structuredClone(sequence.report);
    report.overallSimilarity = Number.NaN;
    expect(isAnalysisReport(report)).toBe(false);
  });

  it("rejects malformed workout fields that screens dereference", () => {
    const workout = structuredClone(sequence.report.workouts[0]) as unknown as Record<
      string,
      unknown
    >;
    workout.focus = null;
    expect(isWorkout(workout)).toBe(false);
  });

  it("accepts generated workouts and only supported themes", () => {
    expect(sequence.report.workouts.every(isWorkout)).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
  });

  it("accepts only canonical ISO timestamps", () => {
    expect(isIsoTimestamp("2026-07-15T12:34:56.789Z")).toBe(true);
    expect(isIsoTimestamp("July 15, 2026")).toBe(false);
    expect(isIsoTimestamp("2026-13-99T99:99:99.999Z")).toBe(false);
  });

  it("accepts raster thumbnails but rejects active or malformed data URLs", () => {
    expect(isRasterImageDataUrl("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(isRasterImageDataUrl("data:image/jpeg;base64,/9j/AA==")).toBe(true);
    expect(isRasterImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isRasterImageDataUrl("data:text/html;base64,PGgxPkJvb208L2gxPg==")).toBe(false);
    expect(isRasterImageDataUrl("data:image/png;base64,%%%")).toBe(false);
  });
});
