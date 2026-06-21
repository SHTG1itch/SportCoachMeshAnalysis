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

function req(overrides: Partial<GuideRequest["numericReport"]> = {}, sport: SportMeta = SPORT): GuideRequest {
  return {
    sport,
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

  it("grounds the observation in the actual numbers (the mesh mismatch)", () => {
    const { guide } = generateGuideAndWorkouts(req());
    const elbow = guide.keyIssues.find((i) => i.joint === "right_elbow")!;
    expect(elbow.observation).toContain("18°"); // the gap
    expect(elbow.observation).toContain("118°"); // user value (100 + 18)
    expect(elbow.observation).toContain("100°"); // pro value
  });

  it("frames the fix as matching the pro's skeleton", () => {
    const { guide } = generateGuideAndWorkouts(req());
    for (const issue of guide.keyIssues) {
      expect(issue.fix.toLowerCase()).toContain("match the pro");
    }
  });

  it("orders issues by magnitude (biggest first)", () => {
    const { guide } = generateGuideAndWorkouts(req());
    expect(guide.keyIssues[0].joint).toBe("right_elbow"); // 18 > 12
  });

  // ---- Sport-agnostic: coaching must NOT depend on the sport ----

  it("produces identical coaching for the same mesh mismatch across different sports", () => {
    const deltas = [delta("right_hip", 20, -20, "high"), delta("right_knee", 14, -14, "medium")];
    const tennis = generateGuideAndWorkouts(req({ jointDeltas: deltas }, SPORT));
    const swimming = generateGuideAndWorkouts(
      req({ jointDeltas: deltas }, { id: "swimming", name: "Swimming", shots: ["Freestyle"], keyJoint: "right_wrist", description: "" }),
    );
    const custom = generateGuideAndWorkouts(
      req({ jointDeltas: deltas }, { id: "custom", name: "Custom", shots: ["Motion"], keyJoint: "right_wrist", description: "" }),
    );
    // The coaching content (issues, cues, drills, muscle targets) is purely
    // mesh-driven, so it is identical regardless of sport.
    expect(swimming.guide.keyIssues).toEqual(tennis.guide.keyIssues);
    expect(custom.guide.keyIssues).toEqual(tennis.guide.keyIssues);
    expect(swimming.guide.cues).toEqual(tennis.guide.cues);
    expect(swimming.guide.drills).toEqual(tennis.guide.drills);
  });

  it("contains no sport-specific jargon (no 'unit turn', 'serve', etc.)", () => {
    const { guide } = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("right_hip", 22, -22, "high"),
          delta("trunk_rotation", 16, -16, "high"),
          delta("right_shoulder", 12, 12, "medium"),
        ],
      }),
    );
    const text = JSON.stringify(guide).toLowerCase();
    for (const jargon of ["unit turn", "x-factor", "serve", "forehand stroke", "kick", "pitch", "contact point", "swing plane"]) {
      expect(text).not.toContain(jargon);
    }
  });

  // ---- Muscle-group driven coaching + workouts ----

  it("ties each flagged joint to the muscle groups that drive it", () => {
    const { guide } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 20, -20, "high"), delta("right_knee", 14, -14, "high")] }),
    );
    const hip = guide.keyIssues.find((i) => i.joint === "right_hip")!;
    const knee = guide.keyIssues.find((i) => i.joint === "right_knee")!;
    expect(hip.muscles).toBeTruthy();
    expect(hip.muscles).toEqual(expect.arrayContaining(["glutes", "hamstrings"]));
    expect(knee.muscles).toEqual(expect.arrayContaining(["quadriceps"]));
    // The "driven by" line names the muscles too.
    expect(hip.cause.toLowerCase()).toContain("glutes");
  });

  it("recommends workouts targeting the muscle groups behind the mismatch", () => {
    const { workouts } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_knee", 20, -20, "high")] }),
    );
    for (const w of workouts) {
      expect(w.targetsMuscles).toBeTruthy();
      // A knee mismatch is driven by the quadriceps and hamstrings.
      expect(w.targetsMuscles).toEqual(expect.arrayContaining(["quadriceps"]));
    }
    const strength = workouts.find((w) => w.title === "Corrective strength")!;
    // The actual strength exercise comes from the implicated muscle group.
    expect(strength.main.some((s) => s.name === "Goblet squat")).toBe(true); // quads
  });

  it("includes a match-the-pro position hold grounded in the measured angles", () => {
    const { workouts } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 24, -24, "high")] }),
    );
    const flex = workouts.find((w) => w.title === "Flexibility & position-matching")!;
    const hold = flex.main.find((s) => s.name.startsWith("Match-the-pro hold"))!;
    expect(hold).toBeTruthy();
    expect(hold.description).toContain("24°"); // the gap to close
    expect(hold.description).toContain("100°"); // the pro's angle to match
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

  it("never lists a body-part group as both a key issue and a strength", () => {
    const { guide } = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("right_knee", 18, 18, "high"), // flagged
          delta("left_knee", 3, -3, "low"), // well-matched
          delta("trunk_lean", 1, 1, "low"), // a genuine, non-conflicting strength
        ],
      }),
    );
    const issueGroups = guide.keyIssues
      .map((i) => i.joint)
      .filter((j): j is JointName => !!j)
      .map((j) => (j.endsWith("knee") ? "knee" : j));
    expect(issueGroups).toContain("knee");
    expect(guide.strengths.some((s) => s.toLowerCase().includes("knee"))).toBe(false);
  });

  it("reports the gap as the systematic offset (|bias|), consistent with the means", () => {
    const { guide } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 30, -24, "high")] }),
    );
    const hip = guide.keyIssues.find((i) => i.joint === "right_hip")!;
    expect(hip.observation).toContain("24°");
    expect(hip.observation).toContain("less");
    expect(hip.observation).not.toContain("30°");
  });

  it("scales strengthening volume with measured severity (extra set for high-significance gaps)", () => {
    const { workouts } = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("right_hip", 24, -24, "high"),
          delta("trunk_rotation", 9, -9, "medium"),
        ],
      }),
    );
    const strength = workouts.find((w) => w.title === "Corrective strength")!;
    // Hamstrings (driven by the high-significance hip gap) earn an extra set.
    const hamStep = strength.main.find((s) => s.name === "Romanian deadlift")!;
    // Obliques (driven by the medium trunk-rotation gap) stay at the base dose.
    const obliqueStep = strength.main.find((s) => s.name === "Cable rotational chop")!;
    expect(hamStep.sets).toBe(4); // high gap → +1 set over the KB's 3
    expect(hamStep.description).toContain("24°");
    expect(obliqueStep.sets).toBe(3); // medium gap → standard dose
  });

  it("grounds the strength workout's focus in the measured muscle-group gaps", () => {
    const { workouts } = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_hip", 24, -24, "high")] }),
    );
    const strength = workouts.find((w) => w.title === "Corrective strength")!;
    expect(strength.focus.toLowerCase()).toContain("hip");
    expect(strength.focus).toContain("24°");
    expect(strength.focus.toLowerCase()).toMatch(/glutes|hamstrings/);
  });

  it("appends progression guidance matched to the difficulty", () => {
    const easy = generateGuideAndWorkouts(
      req({ jointDeltas: [delta("right_elbow", 8, 8, "medium")] }),
    ).workouts.find((w) => w.title === "Corrective strength")!;
    const hard = generateGuideAndWorkouts(
      req({
        jointDeltas: [
          delta("right_elbow", 20, 20, "high"),
          delta("trunk_rotation", 18, -18, "high"),
        ],
      }),
    ).workouts.find((w) => w.title === "Corrective strength")!;
    expect(easy.notes).toContain("Start light");
    expect(hard.notes).toContain("form degrades");
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
