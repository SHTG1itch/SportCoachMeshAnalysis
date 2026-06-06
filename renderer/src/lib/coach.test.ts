import { describe, expect, it } from "vitest";
import { generateGuideAndWorkouts } from "./coach";
import type { GuideRequest, JointDelta, JointName, SportMeta } from "@shared/types";

const SPORT: SportMeta = {
  id: "tennis",
  name: "Tennis",
  shots: ["Forehand"],
  keyJoint: "right_wrist",
  description: "Racket sport",
};

function delta(
  joint: JointName,
  meanDeltaDeg: number,
  signedBiasDeg: number,
  significance: JointDelta["significance"],
): JointDelta {
  return {
    joint,
    label: joint.replace(/_/g, " "),
    meanDeltaDeg,
    maxDeltaDeg: meanDeltaDeg + 5,
    proMeanDeg: 100,
    userMeanDeg: 100 + signedBiasDeg,
    signedBiasDeg,
    significance,
  };
}

function req(overrides: Partial<GuideRequest["numericReport"]> = {}): GuideRequest {
  return {
    sport: SPORT,
    shot: "Forehand",
    numericReport: {
      overallSimilarity: 0.7,
      mode: "sequence",
      jointDeltas: [
        delta("right_elbow", 18, 18, "high"),
        delta("trunk_rotation", 12, -12, "medium"),
        delta("left_knee", 2, -2, "low"),
      ],
      phases: [
        { name: "load", startFrame: 0, endFrame: 10, topDeltas: [] },
        { name: "release", startFrame: 11, endFrame: 20, topDeltas: [] },
      ],
      ...overrides,
    },
  };
}

describe("native coach engine", () => {
  it("produces a complete guide with no network/key", () => {
    const { guide, workouts } = generateGuideAndWorkouts(req());
    expect(guide.summary.length).toBeGreaterThan(20);
    expect(guide.keyIssues.length).toBeGreaterThan(0);
    expect(guide.cues.length).toBeGreaterThan(0);
    expect(guide.drills.length).toBeGreaterThan(0);
    expect(workouts.length).toBe(3);
  });

  it("flags significant joints and skips low-significance ones", () => {
    const { guide } = generateGuideAndWorkouts(req());
    const joints = guide.keyIssues.map((i) => i.joint);
    expect(joints).toContain("right_elbow");
    expect(joints).toContain("trunk_rotation");
    expect(joints).not.toContain("left_knee"); // low significance
  });

  it("is direction-aware: positive bias = too much, negative = too little", () => {
    const { guide } = generateGuideAndWorkouts(req());
    const elbow = guide.keyIssues.find((i) => i.joint === "right_elbow")!;
    const trunk = guide.keyIssues.find((i) => i.joint === "trunk_rotation")!;
    expect(elbow.title.toLowerCase()).toContain("too much"); // +18
    expect(trunk.title.toLowerCase()).toContain("too little"); // -12
  });

  it("grounds the observation in the actual numbers", () => {
    const { guide } = generateGuideAndWorkouts(req());
    const elbow = guide.keyIssues.find((i) => i.joint === "right_elbow")!;
    expect(elbow.observation).toContain("18°"); // the gap
    expect(elbow.observation).toContain("118°"); // user value (100 + 18)
    expect(elbow.observation).toContain("100°"); // pro value
  });

  it("orders issues by magnitude (biggest first)", () => {
    const { guide } = generateGuideAndWorkouts(req());
    expect(guide.keyIssues[0].joint).toBe("right_elbow"); // 18 > 12
  });

  it("builds workouts with full structure, unique ids, and targeted joints", () => {
    const { workouts } = generateGuideAndWorkouts(req());
    const ids = workouts.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const w of workouts) {
      expect(w.warmup.length).toBeGreaterThan(0);
      expect(w.main.length).toBeGreaterThan(0);
      expect(w.cooldown.length).toBeGreaterThan(0);
      expect(w.durationMin).toBeGreaterThan(0);
      expect(w.targetsJoints).toContain("right_elbow");
    }
  });

  it("escalates difficulty with more high-significance issues", () => {
    const easy = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_elbow", 8, 8, "medium")] }),
    );
    const hard = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("right_elbow", 20, 20, "high"),
          delta("trunk_rotation", 18, -18, "high"),
        ],
      }),
    );
    const strengthEasy = easy.workouts.find((w) => w.title === "Corrective strength")!;
    const strengthHard = hard.workouts.find((w) => w.title === "Corrective strength")!;
    expect(strengthEasy.difficulty).toBe("beginner");
    expect(strengthHard.difficulty).toBe("advanced");
  });

  it("localizes the fix to the worst phase and scales advice with magnitude", () => {
    const r = req({
      jointDeltas: [delta("right_elbow", 24, 24, "high")],
      phases: [
        // The systematic bias (not the noisy mean-abs) localizes the fault: it is
        // larger in the release phase, so that is where the fix should point.
        { name: "load", startFrame: 0, endFrame: 10, topDeltas: [delta("right_elbow", 20, 12, "high")] },
        { name: "release", startFrame: 11, endFrame: 20, topDeltas: [delta("right_elbow", 22, 24, "high")] },
      ],
    });
    const { guide } = generateGuideAndWorkouts(r);
    const elbow = guide.keyIssues.find((i) => i.joint === "right_elbow")!;
    expect(elbow.fix).toContain("release"); // delta is largest in the release phase
    expect(elbow.fix).toContain("Prioritize this"); // 24° ≥ 20° → high priority
    expect(elbow.observation).toContain("major"); // 24° ≥ 20° severity bucket
  });

  it("uses a gentler severity word for small gaps", () => {
    const r = req({ jointDeltas: [delta("right_elbow", 8, 8, "medium")] });
    const { guide } = generateGuideAndWorkouts(r);
    const elbow = guide.keyIssues.find((i) => i.joint === "right_elbow")!;
    expect(elbow.observation).toContain("small");
    expect(elbow.fix).not.toContain("Prioritize this");
  });

  it("collapses left/right of the same joint into one issue", () => {
    const { guide } = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("left_knee", 22, -22, "high"),
          delta("right_knee", 18, -18, "high"),
          delta("trunk_rotation", 14, -14, "medium"),
        ],
      }),
    );
    const kneeIssues = guide.keyIssues.filter((i) => i.joint?.endsWith("knee"));
    expect(kneeIssues).toHaveLength(1); // not one per side
    expect(kneeIssues[0].joint).toBe("left_knee"); // the worse (|bias| 22 > 18) side
  });

  it("reports the gap as the systematic offset (|bias|), consistent with the means", () => {
    const { guide } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 30, -24, "high")] }),
    );
    const hip = guide.keyIssues.find((i) => i.joint === "right_hip")!;
    // proMean 100, userMean 76 → "about 24° less", NOT the 30° mean-abs delta.
    expect(hip.observation).toContain("24°");
    expect(hip.observation).toContain("less");
    expect(hip.observation).not.toContain("30°");
  });

  it("gives tennis-specific drills/cues; other sports fall back to the generic engine", () => {
    const tennis = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 20, -20, "high")] }),
    );
    const golf = generateGuideAndWorkouts({
      sport: { id: "golf", name: "Golf", shots: ["Full swing — iron"], keyJoint: "right_wrist", description: "" },
      shot: "Full swing — iron",
      numericReport: {
        overallSimilarity: 0.7,
        mode: "sequence",
        jointDeltas: [delta("right_hip", 20, -20, "high")],
        phases: [],
      },
    });
    const tennisHip = tennis.guide.keyIssues[0].fix.toLowerCase();
    const golfHip = golf.guide.keyIssues[0].fix.toLowerCase();
    expect(tennisHip).toContain("unit turn"); // tennis-specific language
    expect(golfHip).not.toContain("unit turn"); // generic fallback
    expect(tennisHip).not.toBe(golfHip);
  });

  it("is deterministic — identical input yields identical output", () => {
    expect(generateGuideAndWorkouts(req())).toEqual(generateGuideAndWorkouts(req()));
  });

  it("still produces useful output when nothing is flagged", () => {
    const { guide, workouts } = generateGuideAndWorkouts(
      req({
        overallSimilarity: 0.95,
        jointDeltas: [delta("right_elbow", 2, 2, "low"), delta("left_knee", 1, -1, "low")],
      }),
    );
    expect(guide.strengths.length).toBeGreaterThan(0);
    expect(workouts.length).toBe(3);
  });
});
