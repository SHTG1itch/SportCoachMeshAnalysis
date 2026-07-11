// Native, offline coaching engine — SPORT-AGNOSTIC.
//
// The coaching is grounded entirely in the skeletal-mesh mismatch between the
// user and the professional: for each joint, how the user's measured angle
// differs from the pro's and which physical change closes that gap. It contains
// NO sport-specific knowledge, so it works for every possible sport (and the
// "custom" sport for anything not in the registry). The recommended workouts are
// built from the MUSCLE GROUPS that govern each mismatched joint, so training
// targets the muscles that could be causing the difference.
//
// Every statement is derived deterministically from the actual joint-delta
// numbers — no API key, no network call, no hallucinated angles.

import type {
  GuideRequest,
  GuideResponse,
  ImprovementGuide,
  JointDelta,
  JointName,
  PhaseSummary,
  Workout,
  WorkoutStep,
} from "@shared/types";

type Dir = "more" | "less";

/** Normalize a joint name to its body-part key (strip left_/right_). */
function jointKey(joint: JointName): string {
  if (joint.endsWith("elbow")) return "elbow";
  if (joint.endsWith("shoulder")) return "shoulder";
  if (joint.endsWith("hip")) return "hip";
  if (joint.endsWith("knee")) return "knee";
  if (joint.endsWith("ankle")) return "ankle";
  return joint; // trunk_rotation, trunk_lean, shoulder_line_tilt
}

// ---------------------------------------------------------------------------
// Joint mechanics — universal, mesh-matching coaching per joint group.
//
// `observation` describes WHAT differs from the pro (the mesh mismatch).
// `correction` says HOW to change your body to MATCH the pro's mesh — a pure
// physical instruction with no sport concepts. `cue` is a short in-the-moment
// reminder. `drill` is a universal "match the pro" rehearsal. None of this
// references any sport.
// ---------------------------------------------------------------------------

interface DirText {
  observation: string; // completed with the numeric clause by the caller
  correction: string;
  cue: string;
}

interface JointMechanics {
  /** Short body-part phrase, e.g. "elbow", "trunk rotation". */
  group: string;
  /** Plain-language name of the movement this angle measures. */
  movement: string;
  more: DirText; // user angle HIGHER than pro (signedBias > 0)
  less: DirText; // user angle LOWER than pro (signedBias < 0)
  /** A universal, sport-agnostic rehearsal for matching the pro at this joint. */
  drill: string;
  /** Muscle groups (keys into MUSCLES) that govern this joint's position, most
   * responsible first. The workouts are built from these. */
  muscles: string[];
}

const MECHANICS: Record<string, JointMechanics> = {
  elbow: {
    group: "elbow",
    movement: "how much the elbow is bent",
    more: {
      observation: "your elbow stays more bent than the pro's",
      correction: "straighten your arm more fully through this position to match the pro",
      cue: "longer arm to match the pro",
    },
    less: {
      observation: "your elbow is straighter than the pro's",
      correction: "keep a softer bend in the arm to match the pro's elbow angle",
      cue: "softer elbow to match the pro",
    },
    drill: "Slow-motion reps freezing the elbow at the pro's angle, filmed side-on to compare",
    muscles: ["triceps", "biceps", "forearms"],
  },
  shoulder: {
    group: "shoulder",
    movement: "how far the upper arm is raised away from the torso",
    more: {
      observation: "your arm is carried further from your torso than the pro's",
      correction: "bring your upper arm closer to your body to match the pro",
      cue: "arm in closer to match",
    },
    less: {
      observation: "your arm stays closer to your torso than the pro's",
      correction: "create more space between your arm and torso to match the pro's arm position",
      cue: "more arm separation to match",
    },
    drill: "Mirror or filmed arm-position holds matching the pro's shoulder angle",
    muscles: ["deltoids", "lats", "rotator_cuff"],
  },
  hip: {
    group: "hip",
    movement: "how much you fold/hinge at the hips",
    more: {
      observation: "you fold more at the hips than the pro",
      correction: "stand a touch taller at the hips to match the pro's posture",
      cue: "taller hips to match",
    },
    less: {
      observation: "your hips are more open/upright than the pro's",
      correction: "hinge deeper at the hips to match the pro's loaded position",
      cue: "hinge more to match",
    },
    drill: "Hip-hinge holds set to the pro's hip angle, filmed and compared",
    muscles: ["glutes", "hamstrings", "hip_flexors", "adductors"],
  },
  knee: {
    group: "knee",
    movement: "how much the knee is bent",
    more: {
      observation: "your knee stays more bent than the pro's",
      correction: "straighten the knee a little to match the pro",
      cue: "less knee bend to match",
    },
    less: {
      observation: "your knee is straighter than the pro's",
      correction: "add more knee bend to match the pro's loaded position",
      cue: "more knee bend to match",
    },
    drill: "Loaded knee-bend holds set to the pro's knee angle",
    muscles: ["quadriceps", "hamstrings"],
  },
  ankle: {
    group: "ankle",
    movement: "how much the ankle is flexed",
    more: {
      observation: "your ankle is more flexed (shin further over the toes) than the pro's",
      correction: "let the shin sit back a little so the ankle angle matches the pro",
      cue: "ease the ankle to match",
    },
    less: {
      observation: "your ankle is stiffer/less flexed than the pro's",
      correction: "allow more ankle flex so the angle matches the pro",
      cue: "more ankle flex to match",
    },
    drill: "Controlled ankle-position holds matching the pro's angle",
    muscles: ["calves", "tibialis"],
  },
  trunk_rotation: {
    group: "trunk rotation",
    movement: "how far your shoulders rotate relative to your hips",
    more: {
      observation: "you rotate your shoulders further from your hips than the pro (more separation)",
      correction: "rotate your shoulders a little less relative to your hips to match the pro",
      cue: "less shoulder-hip separation to match",
    },
    less: {
      observation: "you create less shoulder-to-hip rotation than the pro",
      correction: "rotate your shoulders further against your hips to match the pro's separation",
      cue: "more shoulder turn to match",
    },
    drill: "Rotation holds matching the pro's shoulder-vs-hip angle, filmed from behind",
    muscles: ["obliques", "core"],
  },
  trunk_lean: {
    group: "trunk lean",
    movement: "how far your torso leans forward (negative = leaning back)",
    more: {
      observation: "your torso leans further forward than the pro's",
      correction: "stand a touch taller through the spine to match the pro's posture",
      cue: "stack taller to match",
    },
    less: {
      observation: "your torso stays more upright — or drifts back — compared to the pro's forward lean",
      correction: "hinge your torso a little further forward to match the pro's angle",
      cue: "match the pro's forward lean",
    },
    drill: "Posture holds set to the pro's torso angle, filmed side-on",
    muscles: ["core", "erector_spinae", "hip_flexors"],
  },
  shoulder_line_tilt: {
    group: "shoulder line tilt",
    movement: "how tilted your shoulder line is (one shoulder higher than the other)",
    more: {
      observation: "your shoulders are more tilted (one higher than the other) than the pro's",
      correction: "level your shoulders more to match the pro",
      cue: "level the shoulders to match",
    },
    less: {
      observation: "your shoulder line stays flatter/more level than the pro's",
      correction: "let your shoulder line tilt a little more to match the pro's angle",
      cue: "match the pro's tilt",
    },
    drill: "Filmed shoulder-line holds matching the pro's tilt",
    muscles: ["obliques", "core", "traps"],
  },
};

// ---------------------------------------------------------------------------
// Muscle groups — what the workouts actually train.
//
// Each muscle group carries a mobilize / strengthen / stretch step, so a
// mismatch can be addressed whether it is driven by tightness (limited range) or
// weakness (can't produce/control the position). The workout builder selects
// muscle groups from the mismatched joints (JointMechanics.muscles).
// ---------------------------------------------------------------------------

interface MuscleKnowledge {
  /** Friendly display label, e.g. "glutes & hips". */
  label: string;
  mobilize: WorkoutStep;
  strengthen: WorkoutStep;
  stretch: WorkoutStep;
}

const MUSCLES: Record<string, MuscleKnowledge> = {
  triceps: {
    label: "triceps",
    mobilize: { name: "Arm circles + elbow CARs", durationSec: 60, description: "Controlled rotations to prime the elbow and shoulder.", cues: ["full range", "slow"] },
    strengthen: { name: "Cable/band triceps extension", sets: 3, reps: "10-12", description: "Drive full elbow extension under control.", cues: ["lock out", "controlled return"] },
    stretch: { name: "Overhead triceps stretch", durationSec: 40, description: "Lengthen the triceps and elbow flexors.", cues: ["relax", "breathe"] },
  },
  biceps: {
    label: "biceps",
    mobilize: { name: "Elbow CARs + wrist circles", durationSec: 60, description: "Mobilize the elbow through its full range.", cues: ["slow", "full range"] },
    strengthen: { name: "Dumbbell biceps curl", sets: 3, reps: "10-12", description: "Build elbow-flexion strength and control.", cues: ["no swing", "full range"] },
    stretch: { name: "Wall biceps stretch", durationSec: 40, description: "Lengthen the biceps and front of the elbow.", cues: ["gentle", "breathe"] },
  },
  forearms: {
    label: "forearms",
    mobilize: { name: "Wrist circles + flexor/extensor rocks", durationSec: 60, description: "Prime the wrist and forearm.", cues: ["slow", "pain-free"] },
    strengthen: { name: "Wrist curls + reverse curls", sets: 3, reps: "12-15", description: "Build grip and forearm control.", cues: ["full range", "light"] },
    stretch: { name: "Kneeling wrist stretch", durationSec: 40, description: "Lengthen the wrist flexors and extensors.", cues: ["gentle", "breathe"] },
  },
  deltoids: {
    label: "shoulders (deltoids)",
    mobilize: { name: "Band shoulder dislocates", durationSec: 60, description: "Pass a band overhead and back to open the shoulders.", cues: ["straight arms", "smooth"] },
    strengthen: { name: "Landmine press", sets: 3, reps: "8-10", description: "Build stable overhead pressing strength.", cues: ["ribs down", "full press"] },
    stretch: { name: "Cross-body shoulder stretch", durationSec: 40, description: "Open the rear shoulder.", cues: ["relax", "breathe"] },
  },
  rotator_cuff: {
    label: "rotator cuff",
    mobilize: { name: "Band external rotations", durationSec: 60, description: "Warm and stabilize the shoulder.", cues: ["elbow pinned", "slow"] },
    strengthen: { name: "Band face pulls", sets: 3, reps: "12-15", description: "Strengthen the rotator cuff and rear shoulder.", cues: ["pull to the face", "squeeze"] },
    stretch: { name: "Sleeper stretch", durationSec: 40, description: "Lengthen the posterior cuff.", cues: ["gentle", "no pinch"] },
  },
  lats: {
    label: "lats",
    mobilize: { name: "Wall slides with scapular control", durationSec: 60, description: "Free the shoulders and engage the scapula.", cues: ["ribs down", "arms on wall"] },
    strengthen: { name: "Lat pulldown / band pulldown", sets: 3, reps: "10-12", description: "Build pulling strength and shoulder control.", cues: ["lead with elbows", "controlled"] },
    stretch: { name: "Overhead lat stretch", durationSec: 40, description: "Lengthen the lats and lateral trunk.", cues: ["reach long", "breathe"] },
  },
  glutes: {
    label: "glutes",
    mobilize: { name: "90/90 hip switches", durationSec: 60, description: "Rotate between hip positions to free the joint.", cues: ["control", "tall chest"] },
    strengthen: { name: "Hip thrust", sets: 3, reps: "8-10", description: "Build hip-extension power.", cues: ["squeeze at top", "ribs down"] },
    stretch: { name: "Figure-4 glute stretch", durationSec: 40, description: "Open the glutes and external rotators.", cues: ["relax", "breathe"] },
  },
  hamstrings: {
    label: "hamstrings",
    mobilize: { name: "Leg swings", durationSec: 60, description: "Dynamic swings to free the hamstrings and hips.", cues: ["controlled", "tall posture"] },
    strengthen: { name: "Romanian deadlift", sets: 3, reps: "8-10", description: "Train the hip hinge and posterior chain.", cues: ["push hips back", "flat back"] },
    stretch: { name: "Standing hamstring stretch", durationSec: 40, description: "Lengthen the hamstrings.", cues: ["soft knee", "hinge"] },
  },
  hip_flexors: {
    label: "hip flexors",
    mobilize: { name: "World's greatest stretch", durationSec: 60, description: "Open the hip flexors and rotate the trunk.", cues: ["long lunge", "rotate"] },
    strengthen: { name: "Lying/hanging leg raises", sets: 3, reps: "10-12", description: "Strengthen the hip flexors and lower core.", cues: ["slow", "no swing"] },
    stretch: { name: "Couch stretch", durationSec: 45, description: "Open the hip flexors of each leg.", cues: ["squeeze glute", "tall"] },
  },
  quadriceps: {
    label: "quadriceps",
    mobilize: { name: "Bodyweight squat to stand", durationSec: 60, description: "Grease knee and hip range before loading.", cues: ["heels down", "knees track toes"] },
    strengthen: { name: "Goblet squat", sets: 3, reps: "8-10", description: "Build controlled knee-bend strength.", cues: ["chest up", "drive through floor"] },
    stretch: { name: "Standing quad stretch", durationSec: 40, description: "Lengthen the quads around the knee.", cues: ["knees together", "tall"] },
  },
  adductors: {
    label: "adductors",
    mobilize: { name: "Cossack squat rocks", durationSec: 60, description: "Open the inner thighs and hips.", cues: ["controlled", "flat foot"] },
    strengthen: { name: "Copenhagen plank", sets: 3, reps: "20-30s", description: "Build adductor strength and stability.", cues: ["straight line", "brace"] },
    stretch: { name: "Frog stretch", durationSec: 40, description: "Lengthen the adductors.", cues: ["gentle", "breathe"] },
  },
  calves: {
    label: "calves",
    mobilize: { name: "Knee-to-wall ankle rocks", durationSec: 60, description: "Drive the knee over the toes to free the ankle.", cues: ["heel down", "slow"] },
    strengthen: { name: "Single-leg calf raise", sets: 3, reps: "12-15", description: "Strengthen the calf and stabilize the ankle.", cues: ["full height", "balance"] },
    stretch: { name: "Wall calf stretch", durationSec: 40, description: "Lengthen the calf and Achilles.", cues: ["straight back leg", "heel down"] },
  },
  tibialis: {
    label: "shins (tibialis)",
    mobilize: { name: "Ankle dorsiflexion rocks", durationSec: 60, description: "Mobilize the front of the ankle.", cues: ["controlled", "full range"] },
    strengthen: { name: "Tibialis raises", sets: 3, reps: "15-20", description: "Strengthen the front of the shin for ankle control.", cues: ["slow", "full range"] },
    stretch: { name: "Kneeling shin stretch", durationSec: 40, description: "Lengthen the front of the shin and ankle.", cues: ["gentle", "breathe"] },
  },
  core: {
    label: "core",
    mobilize: { name: "Cat-camel + dead bug", durationSec: 60, description: "Wake up the deep core and spine.", cues: ["slow", "brace"] },
    strengthen: { name: "Plank with reach", sets: 3, reps: "30-40s", description: "Build the core stability to hold posture.", cues: ["flat back", "brace"] },
    stretch: { name: "Child's pose", durationSec: 40, description: "Decompress the spine and trunk.", cues: ["sink hips", "breathe"] },
  },
  obliques: {
    label: "obliques",
    mobilize: { name: "Open-book thoracic rotations", durationSec: 60, description: "Rotate the upper back to free the trunk.", cues: ["follow the hand", "exhale"] },
    strengthen: { name: "Cable rotational chop", sets: 3, reps: "8-10/side", description: "Train rotational power from hips through trunk.", cues: ["start from hips", "fast"] },
    stretch: { name: "Seated spinal twist", durationSec: 40, description: "Lengthen the trunk rotators.", cues: ["tall spine", "breathe"] },
  },
  erector_spinae: {
    label: "lower back (erector spinae)",
    mobilize: { name: "Cat-camel + thoracic extension", durationSec: 60, description: "Mobilize the spine into the working posture.", cues: ["segment by segment", "slow"] },
    strengthen: { name: "Back extension / bird-dog", sets: 3, reps: "10-12", description: "Build spinal-extensor endurance and posture control.", cues: ["long spine", "no overarch"] },
    stretch: { name: "Child's pose", durationSec: 40, description: "Decompress the spine after loading.", cues: ["sink hips", "breathe"] },
  },
  traps: {
    label: "traps",
    mobilize: { name: "Shoulder rolls + neck CARs", durationSec: 60, description: "Free the upper back and neck.", cues: ["slow", "full range"] },
    strengthen: { name: "Suitcase carry", sets: 3, reps: "30m/side", description: "Build anti-tilt lateral and trap strength.", cues: ["stay level", "ribs down"] },
    stretch: { name: "Upper-trap stretch", durationSec: 40, description: "Lengthen the upper traps and neck.", cues: ["gentle", "breathe"] },
  },
};

interface ResolvedKnowledge {
  group: string;
  movement: string;
  observation: string;
  correction: string;
  cue: string;
  drill: string;
  muscles: string[];
}

/** Universal coaching knowledge for a joint+direction — purely mesh-mismatch
 * based, identical for every sport. */
function resolveKnowledge(joint: JointName, dir: Dir): ResolvedKnowledge {
  const group = jointKey(joint);
  const m = MECHANICS[group];
  const base = dir === "more" ? m.more : m.less;
  return {
    group: m.group,
    movement: m.movement,
    observation: base.observation,
    correction: base.correction,
    cue: base.cue,
    drill: m.drill,
    muscles: m.muscles,
  };
}

/** Friendly muscle-group labels for a joint's muscles. */
function muscleLabels(joint: JointName): string[] {
  const m = MECHANICS[jointKey(joint)];
  return m.muscles.map((id) => MUSCLES[id]?.label ?? id);
}

/** Keep only the most significant delta per body-part group (so left and right
 * of the same joint don't both surface). Input should be ordered by importance. */
function dedupeByGroup(deltas: JointDelta[]): JointDelta[] {
  const seen = new Set<string>();
  const out: JointDelta[] = [];
  for (const d of deltas) {
    const g = jointKey(d.joint);
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(d);
  }
  return out;
}

/** The systematic, coachable gap for a joint: |signed bias| = |user − pro|. */
function gapDeg(d: JointDelta): number {
  return Math.abs(d.signedBiasDeg);
}

function numericClause(d: JointDelta): string {
  // The direction word must match the FIX direction (bias sign). The two means
  // are a different statistic (independently-trimmed clip averages vs the
  // trimmed per-pair bias), so on outlier-heavy clips they can round to a 0°
  // difference — or even point the other way — for a genuinely flagged joint.
  // Only quote the means when they visibly agree with the direction word;
  // otherwise describe the bias itself so the sentence never contradicts its
  // own parenthetical.
  const dirWord = d.signedBiasDeg >= 0 ? "more" : "less";
  // Work from the ROUNDED means — the numbers the sentence will actually
  // print. Guarding on the unrounded difference reintroduced the bug at the
  // rounding boundary: user 100.4 vs pro 99.6 passed the guard (diff 0.8 → "1°
  // more") yet printed "100° vs 100°"; 100.7 vs 99.3 printed numbers 2° apart
  // while claiming "about 1°".
  const userR = Math.round(d.userMeanDeg);
  const proR = Math.round(d.proMeanDeg);
  const diff = userR - proR;
  if (Math.abs(diff) >= 1 && Math.sign(diff) === Math.sign(d.signedBiasDeg)) {
    return `(you average ${userR}° vs the pro's ${proR}°, about ${Math.abs(diff)}° ${dirWord})`;
  }
  return `(about ${Math.round(gapDeg(d))}° ${dirWord} through the swing, even though the whole-clip averages nearly match)`;
}

/** Magnitude bucket so advice scales with how far off the user actually is. */
function severityWord(gap: number): string {
  if (gap >= 20) return "a major";
  if (gap >= 12) return "a clear";
  return "a small";
}

/** The phase in which this joint's systematic difference is largest AND points
 * the SAME direction as the overall (fix) bias, if the data localizes it.
 *
 * The sign filter is essential: the fix text's direction ("straighten more" vs
 * "softer bend") comes from the overall signed bias, but each phase carries its
 * OWN independent signed bias (compare.ts buildDelta), which can point the
 * opposite way. Without the filter we could tell the user to straighten the
 * elbow and then send them to rehearse the exact phase where it is already too
 * straight — directly self-contradictory advice. The seed of 0 (was -1) also
 * means a phase where the joint perfectly matches the pro is never chosen. */
function worstPhaseFor(
  joint: JointName,
  phases: PhaseSummary[],
  overallSign: number,
): string | null {
  let best: string | null = null;
  let bestVal = 0;
  for (const p of phases) {
    const hit = p.topDeltas.find((td) => td.joint === joint);
    if (!hit || Math.sign(hit.signedBiasDeg) !== overallSign) continue;
    // Phase-level biases from frames the detector barely saw (motion-blurred
    // contact, occlusion) are guesses — compare.ts refuses to FLAG on them for
    // exactly that reason, so don't send the user to rehearse a phase on the
    // strength of one either.
    if (!confidentlySeen(hit)) continue;
    if (gapDeg(hit) > bestVal) {
      bestVal = gapDeg(hit);
      best = p.name;
    }
  }
  return best;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Join a short list of labels into readable prose ("a, b and c"). */
function listProse(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The body-part groups the workouts will train (one per group, worst gaps
 * first), so the guide can keep them out of the "strengths" list. Mirrors the
 * target selection in buildWorkouts so a joint can never be praised as a
 * strength while a workout simultaneously calls it a gap to close. */
/**
 * A "low" significance can mean two very different things: WELL-MATCHED (small
 * measured gap) or NOT-SEEN (compare() forces low when the joint's detection
 * confidence was under the usability threshold). The no-flagged-faults
 * fallback targets the largest raw gaps — and the largest raw gaps in a
 * low-confidence report are precisely the detector's worst guesses. Restrict
 * every fallback pool to joints the cameras actually saw. Records saved before
 * avgConf existed count as seen (?? 1).
 */
const COACHABLE_CONF = 0.3; // mirrors VIS_THRESHOLD in the pose pipeline
function confidentlySeen(d: JointDelta): boolean {
  return (d.avgConf ?? 1) >= COACHABLE_CONF;
}

function workoutTargetGroups(deltas: JointDelta[]): Set<string> {
  const known = deltas.filter((d) => MECHANICS[jointKey(d.joint)]);
  const flagged = known.filter((d) => d.significance !== "low");
  const seen = known.filter(confidentlySeen);
  const pool = (flagged.length > 0 ? flagged : seen).slice().sort((a, b) => gapDeg(b) - gapDeg(a));
  return new Set(dedupeByGroup(pool).slice(0, 4).map((d) => jointKey(d.joint)));
}

function buildGuide(req: GuideRequest): ImprovementGuide {
  const { shot, numericReport } = req;
  // Defensive: only coach joints we have mechanics for (the 13 features all do;
  // this guards a future/foreign joint from crashing resolveKnowledge).
  const deltas = numericReport.jointDeltas.filter((d) => MECHANICS[jointKey(d.joint)]);
  const flagged = deltas.filter((d) => d.significance !== "low");
  // One issue per body-part group (worst side first), ranked by the systematic
  // gap (|bias|) — the mesh mismatch the user should close.
  const ranked = dedupeByGroup([...flagged].sort((a, b) => gapDeg(b) - gapDeg(a)));
  const top = ranked.slice(0, 4);

  const simPct = Math.round(numericReport.overallSimilarity * 100);

  const keyIssues = top.map((d) => {
    const dir: Dir = d.signedBiasDeg >= 0 ? "more" : "less";
    const t = resolveKnowledge(d.joint, dir);
    const phase = worstPhaseFor(d.joint, numericReport.phases, Math.sign(d.signedBiasDeg));
    const phaseClause = phase
      ? ` It shows up most during the ${phase.replace(/_/g, " ")} phase — focus your reps there.`
      : "";
    const priority = gapDeg(d) >= 20 ? "Prioritize this: " : "";
    const muscles = muscleLabels(d.joint);
    return {
      title: `${titleCase(t.group)}: ${dir === "more" ? "too much" : "too little"} vs the pro`,
      joint: d.joint,
      observation: `${titleCase(t.observation)} ${numericClause(d)} — ${severityWord(gapDeg(d))} gap.`,
      cause: `This position is controlled mainly by your ${listProse(muscles)}.`,
      fix: `${priority}To match the pro, ${t.correction}.${phaseClause}`,
      muscles,
    };
  });

  // Strengths: well-matched joints (smallest gaps), excluding any group that is
  // either flagged OR targeted by a workout — so the same joint can never read
  // as both a strength ("closely matches the pro") and a gap a workout tells the
  // user to close. (When nothing is flagged the workouts still target the
  // largest gaps, which must not also be praised.)
  const issueGroups = new Set(ranked.map((d) => jointKey(d.joint)));
  const targetGroups = workoutTargetGroups(deltas);
  const matched = dedupeByGroup(
    // confidentlySeen: a joint whose "low" came from the confidence override
    // (occluded, not measured) must not be praised as matching the pro.
    // meanDeltaDeg cap: a near-zero BIAS can hide large per-frame differences
    // that merely cancel over the clip (early +15°, late −15°) — "closely
    // matches" must mean the frames actually track the pro, not that the
    // errors averaged out.
    [...deltas]
      .filter((d) => d.significance === "low" && confidentlySeen(d) && d.meanDeltaDeg <= 10)
      .sort((a, b) => a.meanDeltaDeg - b.meanDeltaDeg),
  )
    .filter((d) => !issueGroups.has(jointKey(d.joint)) && !targetGroups.has(jointKey(d.joint)))
    .slice(0, 3)
    .map(
      (d) =>
        `Your ${MECHANICS[jointKey(d.joint)].group} closely matches the pro (within ${Math.max(1, Math.round(Math.max(gapDeg(d), d.meanDeltaDeg)))}°).`,
    );
  // A joint whose "low" significance came from the confidence gate was never
  // measured; when NOTHING was confidently seen, the summary below disclaims
  // the similarity number as a guess — the strengths card must not turn
  // around and praise that same number as "a solid base".
  const anySeen = deltas.some(confidentlySeen);
  const strengths =
    matched.length > 0
      ? matched
      : !anySeen
        ? [
            `You got a rep on film — with your whole body in frame and better light, the next one gets a real joint-by-joint breakdown.`,
          ]
        : simPct >= 60
          ? [`Overall mesh similarity is ${simPct}% — a solid base to build on.`]
          : [
              `You have a complete, comparable rep on film — closing the gaps below is what will move your ${simPct}% similarity up.`,
            ];

  const cues = Array.from(
    new Set(top.map((d) => resolveKnowledge(d.joint, d.signedBiasDeg >= 0 ? "more" : "less").cue)),
  ).slice(0, 6);

  const drills = Array.from(
    new Set(top.map((d) => resolveKnowledge(d.joint, d.signedBiasDeg >= 0 ? "more" : "less").drill)),
  );

  const issueCount = ranked.length;
  // Zero flagged issues does NOT imply a close match: it also happens when the
  // cameras barely saw the athlete (every joint confidence-gated) or when the
  // mismatch lives in timing/dynamics rather than average positions (low
  // similarity, small biases). Praising "closely mirrors the pro" next to a
  // low similarity number contradicts itself in one sentence.
  let summary: string;
  if (issueCount > 0) {
    // The focus-area cards render only `top` (max 4); when more groups were
    // flagged, say so explicitly instead of promising 7 issues and showing 4.
    const countClause =
      issueCount > top.length
        ? `${issueCount} joints to bring into line — the top ${top.length} are below`
        : `${issueCount} joint${issueCount > 1 ? "s" : ""} to bring into line`;
    summary = `Your ${shot} reaches ${simPct}% overall mesh similarity to the pro, with ${countClause}. The biggest is your ${titleCase(resolveKnowledge(top[0].joint, top[0].signedBiasDeg >= 0 ? "more" : "less").group)} (${Math.round(gapDeg(top[0]))}° off). Close each gap by matching the pro's position and training the muscles that drive it.`;
  } else if (!anySeen) {
    summary = `We couldn't see enough of your body clearly to coach specific joints — overall mesh similarity reads ${simPct}%, but the joint detail is a guess. Re-film with your whole body in frame, decent light and the camera side-on for a full breakdown.`;
  } else if (simPct >= 70) {
    summary = `Your ${shot} skeleton closely mirrors the pro at ${simPct}% overall mesh similarity — no major mismatches stood out. Keep reinforcing what's working and chase consistency.`;
  } else {
    summary = `No single joint holds a consistent gap vs the pro, but overall mesh similarity is ${simPct}% — the differences live in timing and movement dynamics rather than average positions. Groove the full motion at slow speed against the pro's sequence, then build back up.`;
  }

  return { summary, strengths, keyIssues, drills, cues };
}

interface MuscleTarget {
  id: string;
  k: MuscleKnowledge;
  /** Largest joint gap (deg) that implicates this muscle. */
  gap: number;
  /** Whether any implicating joint is a high-significance mismatch. */
  high: boolean;
  /** Joint groups (display) this muscle is being trained for. */
  forGroups: string[];
}

/**
 * Rank the muscle groups responsible for the mismatched joints. A muscle's
 * priority is the largest joint gap it governs, so the muscles behind the
 * biggest mesh differences are trained first/hardest. This is the heart of the
 * "workouts based on the muscle groups that could cause a mismatch" design.
 */
function rankMuscles(targets: JointDelta[], limit: number): MuscleTarget[] {
  const byId = new Map<string, MuscleTarget>();
  for (const d of targets) {
    const m = MECHANICS[jointKey(d.joint)];
    if (!m) continue;
    const gap = gapDeg(d);
    const high = d.significance === "high";
    for (const id of m.muscles) {
      const k = MUSCLES[id];
      if (!k) continue;
      const existing = byId.get(id);
      if (existing) {
        existing.gap = Math.max(existing.gap, gap);
        existing.high = existing.high || high;
        if (!existing.forGroups.includes(m.group)) existing.forGroups.push(m.group);
      } else {
        byId.set(id, { id, k, gap, high, forGroups: [m.group] });
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.gap - a.gap).slice(0, limit);
}

function buildWorkouts(req: GuideRequest): Workout[] {
  const { sport, shot, numericReport } = req;
  // Defensive: only build from joints we have mechanics/muscles for (see buildGuide).
  const known = numericReport.jointDeltas.filter((d) => MECHANICS[jointKey(d.joint)]);
  const flagged = known
    .filter((d) => d.significance !== "low")
    .sort((a, b) => gapDeg(b) - gapDeg(a));
  // One target per body-part group; if nothing flagged, target the largest
  // gaps anyway so the workouts are still useful — but only among joints that
  // were confidently SEEN (see confidentlySeen): the unflagged largest gaps in
  // an occluded clip are detector guesses, and workout 3 prescribes literal
  // angles from them.
  const seen = known.filter(confidentlySeen);
  const targets = dedupeByGroup(flagged.length > 0 ? flagged : seen).slice(0, 4);
  const highCount = numericReport.jointDeltas.filter((d) => d.significance === "high").length;
  const difficulty: Workout["difficulty"] =
    highCount >= 2 ? "advanced" : highCount === 1 ? "intermediate" : "beginner";

  // The muscle groups behind the mismatches — the basis for every workout.
  const muscles = rankMuscles(targets, 5);
  // A heavily occluded clip can leave NOTHING flagged and nothing confidently
  // seen: without a fallback the three workouts render as saveable cards with
  // empty exercise lists and dangling "…mesh gaps: ." focus strings. Train the
  // sport-generic foundation instead and say so honestly.
  const genericTargets = muscles.length === 0;
  if (genericTargets) {
    for (const id of ["core", "glutes", "deltoids", "quadriceps"]) {
      const k = MUSCLES[id];
      if (k) muscles.push({ id, k, gap: 0, high: false, forGroups: [] });
    }
  }
  const muscleLabelsList = muscles.map((m) => m.k.label);
  const targetsJoints = Array.from(new Set(targets.map((d) => d.joint)));
  const targetsMuscles = muscles.map((m) => m.id);

  // A muscle implicated by a high-significance mismatch earns an extra strength
  // set so the biggest gaps are trained harder.
  const strengthenFor = (m: MuscleTarget): WorkoutStep => {
    const base = m.k.strengthen;
    if (!m.high || base.sets === undefined) return base;
    return {
      ...base,
      sets: base.sets + 1,
      description: `${base.description} Extra set: this muscle drives one of your largest mesh gaps (${Math.round(m.gap)}°).`,
    };
  };
  const dur = (steps: WorkoutStep[]): number =>
    Math.max(
      10,
      Math.round(
        steps.reduce((acc, s) => acc + (s.durationSec ? s.durationSec / 60 : (s.sets ?? 3) * 1.5), 0),
      ),
    );

  // No flagged mismatch (targets are the seen-joint fallback): the workouts
  // are maintenance, and the focus text must not claim these are "mismatches"
  // — with every gap ~0° that read "driving your biggest mismatches
  // (elbow, 0°)" on a near-perfect comparison.
  const maintenance = flagged.length === 0 && !genericTargets;
  const muscleSummary =
    genericTargets || maintenance
      ? listProse(muscleLabelsList)
      : muscles
          .map((m) => `${m.k.label} (${m.forGroups.join("/")}, ${Math.round(m.gap)}°)`)
          .join(", ");

  // 1. Mobility & activation — free up and switch on the implicated muscles.
  const w1Warm = muscles.slice(0, 4).map((m) => m.k.mobilize);
  const w1Main = muscles.slice(0, 2).map((m) => strengthenFor(m));
  const w1Cool = muscles.slice(0, 2).map((m) => m.k.stretch);
  const workout1: Workout = {
    id: slug([sport.id, shot, "mobility"]),
    title: "Mobility & activation",
    focus: genericTargets
      ? `Free up and switch on the foundation muscles for your ${shot}: ${listProse(muscleLabelsList.slice(0, 4))}. (No joint was seen clearly enough to target specific gaps.)`
      : maintenance
        ? `Free up and switch on the key muscles for your ${shot}: ${listProse(muscleLabelsList.slice(0, 4))}.`
        : `Free up and switch on the muscles behind your ${shot} mesh gaps: ${listProse(muscleLabelsList.slice(0, 4))}.`,
    durationMin: dur([...w1Warm, ...w1Main, ...w1Cool]),
    difficulty: "beginner",
    equipment: ["resistance band"],
    warmup: w1Warm,
    main: w1Main,
    cooldown: w1Cool,
    targetsJoints,
    targetsMuscles,
    notes: "Do this on training days before skill work.",
  };

  // 2. Corrective strength — strengthen the muscle groups causing the mismatch.
  const w2Warm: WorkoutStep[] = [
    { name: "Dynamic full-body warm-up", durationSec: 300, description: "Light cardio plus the mobility drills above.", cues: ["raise heart rate", "move through range"] },
  ];
  const w2Main = muscles.map((m) => strengthenFor(m));
  const w2Cool = muscles.slice(0, 2).map((m) => m.k.stretch);
  const progression: Record<Workout["difficulty"], string> = {
    beginner: "Start light and own every position before adding load.",
    intermediate: "Add load gradually once every rep is crisp.",
    advanced: "Push the main lifts, but end a set the moment form degrades.",
  };
  const workout2: Workout = {
    id: slug([sport.id, shot, "strength"]),
    title: "Corrective strength",
    focus: genericTargets
      ? `Build general strength for your ${shot} across ${muscleSummary}.`
      : maintenance
        ? `No consistent gaps vs the pro stood out — keep the muscle groups behind your ${shot} strong: ${muscleSummary}.`
        : `Strengthen the muscle groups driving your biggest mismatches with the pro: ${muscleSummary}.`,
    durationMin: dur([...w2Warm, ...w2Main, ...w2Cool]),
    difficulty,
    equipment: ["dumbbells", "cable or band", "bench"],
    warmup: w2Warm,
    main: w2Main,
    cooldown: w2Cool,
    targetsJoints,
    targetsMuscles,
    notes: `2–3× per week with a day of recovery between sessions. ${progression[difficulty]}`,
  };

  // 3. Flexibility & position-matching — lengthen the muscles AND rehearse
  //    matching the pro's exact joint positions (the mesh-matching skill).
  const phaseNote =
    numericReport.phases.length > 0
      ? `Pay attention to the ${numericReport.phases.map((p) => p.name.replace(/_/g, " ")).join(" → ")} sequence.`
      : "Rehearse the full motion slowly, then build speed.";
  const w3Stretch = muscles.slice(0, 4).map((m) => m.k.stretch);
  const w3Holds: WorkoutStep[] = targets.slice(0, 3).map((d) => {
    const dir: Dir = d.signedBiasDeg >= 0 ? "more" : "less";
    const t = resolveKnowledge(d.joint, dir);
    // Quote the two clip means only when their ROUNDED difference points the
    // same way as the flagged bias (same guard as numericClause): they are
    // independently-trimmed statistics, and on outlier-heavy clips the printed
    // numbers can instruct moving the angle the OPPOSITE way from the cue on
    // the same rep card. Otherwise phrase the hold from the bias itself.
    const gap = Math.round(gapDeg(d));
    const userR = Math.round(d.userMeanDeg);
    const proR = Math.round(d.proMeanDeg);
    const meansAgree = Math.abs(userR - proR) >= 1 && Math.sign(userR - proR) === Math.sign(d.signedBiasDeg);
    const description =
      gap < 1
        ? `Set your ${t.group} to match the pro's position and hold; film side-on and compare to keep it locked in.`
        : meansAgree
          ? `Set your ${t.group} to the pro's ~${proR}° (you average ${userR}°) and hold; film side-on and compare to close the ~${gap}° gap.`
          : `Hold your ${t.group} angle about ${gap}° ${dir === "more" ? "lower" : "higher"} than your usual position; film side-on and compare against the pro to close the gap.`;
    return {
      name: `Match-the-pro hold — ${t.group}`,
      sets: 3,
      reps: "20-30s holds",
      description,
      cues: [t.cue],
    };
  });
  const workout3: Workout = {
    id: slug([sport.id, shot, "flexibility"]),
    title: "Flexibility & position-matching",
    focus: `Lengthen the tight muscles and groove the corrected positions so your skeleton matches the pro's.`,
    durationMin: dur([...w3Stretch, ...w3Holds]),
    difficulty,
    equipment: ["mat", "a way to film yourself"],
    warmup: [
      { name: "Easy mobility flush", durationSec: 120, description: "Gentle movement to warm up.", cues: ["relax", "full range"] },
    ],
    main: [...w3Holds, ...w3Stretch],
    cooldown: [
      { name: "Relaxed breathing + decompress", durationSec: 120, description: "Down-regulate after the session.", cues: ["slow breaths", "relax"] },
    ],
    targetsJoints,
    targetsMuscles,
    notes: phaseNote,
  };

  return [workout1, workout2, workout3];
}

export function generateGuideAndWorkouts(req: GuideRequest): GuideResponse {
  return { guide: buildGuide(req), workouts: buildWorkouts(req) };
}
