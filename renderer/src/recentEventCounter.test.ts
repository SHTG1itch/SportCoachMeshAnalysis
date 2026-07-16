import { describe, expect, it } from "vitest";
import { RecentEventCounter } from "../../electron/recentEventCounter";

describe("RecentEventCounter", () => {
  it("counts repeated events inside the rolling window", () => {
    const counter = new RecentEventCounter(60_000);
    expect(counter.record(1_000)).toBe(1);
    expect(counter.record(2_000)).toBe(2);
    expect(counter.record(3_000)).toBe(3);
  });

  it("forgets events older than the rolling window", () => {
    const counter = new RecentEventCounter(60_000);
    counter.record(1_000);
    counter.record(2_000);
    expect(counter.record(62_001)).toBe(1);
  });

  it("rejects an invalid window", () => {
    expect(() => new RecentEventCounter(0)).toThrow("positive");
  });
});
