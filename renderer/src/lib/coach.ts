// Native, offline coaching engine.
//
// Turns the numeric technique-comparison report into an ImprovementGuide and a
// set of Workouts WITHOUT any API key or network call. Every statement is
// grounded in the actual joint-delta numbers, so the output is deterministic
// and never hallucinates angles that aren't in the data.
//
// Pure functions, no runtime deps.

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

interface DirText {
  observation: string; // completed with the numeric clause by the caller
  cause: string;
  fix: string;
  cue: string;
}

interface JointKnowledge {
  /** Short body-part phrase, e.g. "elbow", "trunk rotation". */
  group: string;
  more: DirText; // user value HIGHER than pro (signedBias > 0)
  less: DirText; // user value LOWER than pro (signedBias < 0)
  drill: string;
  mobilize: WorkoutStep;
  strengthen: WorkoutStep;
  stretch: WorkoutStep;
}

/** Normalize a joint name to its body-part key (strip left_/right_). */
function jointKey(joint: JointName): string {
  if (joint.endsWith("elbow")) return "elbow";
  if (joint.endsWith("shoulder")) return "shoulder";
  if (joint.endsWith("hip")) return "hip";
  if (joint.endsWith("knee")) return "knee";
  if (joint.endsWith("ankle")) return "ankle";
  return joint; // trunk_rotation, trunk_lean, shoulder_line_tilt
}

const KB: Record<string, JointKnowledge> = {
  elbow: {
    group: "elbow",
    more: {
      observation: "your elbow stays more bent through the motion",
      cause: "an over-flexed elbow shortens the lever and leaks power before release",
      fix: "extend the arm later and more fully so the forearm whips through contact",
      cue: "long arm at contact",
    },
    less: {
      observation: "your elbow is straighter than the pro's",
      cause: "an over-extended elbow removes the elastic load the forearm needs to accelerate",
      fix: "keep a soft bend through the load phase, then snap to extension at contact",
      cue: "soft load, snap late",
    },
    drill: "Band-resisted elbow extension snaps",
    mobilize: { name: "Arm circles + elbow CARs", durationSec: 60, description: "Controlled rotations to prime the elbow and shoulder.", cues: ["full range", "slow"] },
    strengthen: { name: "Cable triceps extension", sets: 3, reps: "10-12", description: "Drive full elbow extension under control.", cues: ["lock out", "controlled return"] },
    stretch: { name: "Overhead triceps stretch", durationSec: 40, description: "Lengthen the triceps and elbow flexors.", cues: ["relax", "breathe"] },
  },
  shoulder: {
    group: "shoulder",
    more: {
      observation: "your arm is carried more abducted (further from the torso)",
      cause: "excess abduction puts the shoulder in a weaker, injury-prone position and disconnects it from trunk drive",
      fix: "keep the upper arm closer to the body so trunk rotation drives the arm",
      cue: "elbow tighter to ribs",
    },
    less: {
      observation: "your arm stays closer to the torso than the pro's",
      cause: "too little abduction reduces the swing arc and the range available to generate speed",
      fix: "create more separation between arm and torso during the load to lengthen the arc",
      cue: "make a bigger arc",
    },
    drill: "Wall slides with scapular control",
    mobilize: { name: "Band shoulder dislocates", durationSec: 60, description: "Pass a band overhead and back to open the shoulders.", cues: ["straight arms", "smooth"] },
    strengthen: { name: "Landmine press", sets: 3, reps: "8-10", description: "Build stable overhead pressing strength.", cues: ["ribs down", "full press"] },
    stretch: { name: "Doorway pec stretch", durationSec: 40, description: "Open the chest and front of the shoulder.", cues: ["gentle", "breathe"] },
  },
  hip: {
    group: "hip",
    more: {
      observation: "you sit into more hip flexion (more hinge/squat)",
      cause: "excess hip flexion can collapse posture and shift load off the kinetic chain",
      fix: "stand a touch taller through the hips while keeping athletic tension",
      cue: "tall hips, soft knees",
    },
    less: {
      observation: "your hips are more extended/upright than the pro's",
      cause: "too little hip hinge limits the load you can store in the glutes and hamstrings",
      fix: "hinge deeper to load the hips before you drive",
      cue: "load the hips first",
    },
    drill: "Hip-hinge to vertical jump",
    mobilize: { name: "90/90 hip switches", durationSec: 60, description: "Rotate between hip positions to free the joint.", cues: ["control", "tall chest"] },
    strengthen: { name: "Romanian deadlift", sets: 3, reps: "8-10", description: "Train the hip hinge and posterior chain.", cues: ["push hips back", "flat back"] },
    stretch: { name: "Couch stretch", durationSec: 45, description: "Open the hip flexors of each leg.", cues: ["squeeze glute", "tall"] },
  },
  knee: {
    group: "knee",
    more: {
      observation: "your knee stays more bent",
      cause: "over-flexed knees can mean you're sitting in the load too long and losing drive timing",
      fix: "use the bend to spring — extend explosively rather than dwelling in the squat",
      cue: "bend then explode",
    },
    less: {
      observation: "your knee is straighter than the pro's",
      cause: "stiff, straight knees skip the elastic load that powers the legs",
      fix: "add an athletic knee bend during the load phase",
      cue: "athletic knee bend",
    },
    drill: "Countermovement jumps",
    mobilize: { name: "Bodyweight squat to stand", durationSec: 60, description: "Grease knee and hip range before loading.", cues: ["heels down", "knees track toes"] },
    strengthen: { name: "Goblet squat", sets: 3, reps: "8-10", description: "Build controlled knee-bend strength.", cues: ["chest up", "drive through floor"] },
    stretch: { name: "Standing quad stretch", durationSec: 40, description: "Lengthen the quads around the knee.", cues: ["knees together", "tall"] },
  },
  ankle: {
    group: "ankle",
    more: {
      observation: "you show more ankle dorsiflexion (shin over toes)",
      cause: "excess dorsiflexion can mean weight is too far forward, hurting balance at contact",
      fix: "keep weight centered over the mid-foot through the strike",
      cue: "stay over mid-foot",
    },
    less: {
      observation: "your ankle is stiffer/less flexed than the pro's",
      cause: "limited ankle range reduces ground force and a stable base at contact",
      fix: "allow the shin to travel forward and lock the ankle firmly at contact",
      cue: "firm ankle at contact",
    },
    drill: "Banded ankle dorsiflexion mobilizations",
    mobilize: { name: "Knee-to-wall ankle rocks", durationSec: 60, description: "Drive the knee over the toes to free the ankle.", cues: ["heel down", "slow"] },
    strengthen: { name: "Single-leg calf raise", sets: 3, reps: "12-15", description: "Strengthen the calf and stabilize the ankle.", cues: ["full height", "balance"] },
    stretch: { name: "Wall calf stretch", durationSec: 40, description: "Lengthen the calf and Achilles.", cues: ["straight back leg", "heel down"] },
  },
  trunk_rotation: {
    group: "trunk rotation",
    more: {
      observation: "you create more separation between shoulders and hips",
      cause: "over-rotation can desync the kinetic chain and stress the lower back",
      fix: "time the rotation so hips lead and shoulders follow rather than over-coiling",
      cue: "hips lead, shoulders follow",
    },
    less: {
      observation: "you create less shoulder-hip separation (X-factor) than the pro",
      cause: "limited separation wastes the trunk's stretch-shorten power that drives the whole motion",
      fix: "coil the shoulders against stable hips to build separation before you unwind",
      cue: "coil, then unwind",
    },
    drill: "Medicine-ball rotational throws",
    mobilize: { name: "Open-book thoracic rotations", durationSec: 60, description: "Rotate the upper back to free the trunk.", cues: ["follow the hand", "exhale"] },
    strengthen: { name: "Cable rotational chop", sets: 3, reps: "8-10/side", description: "Train rotational power from hips through trunk.", cues: ["start from hips", "fast"] },
    stretch: { name: "Seated spinal twist", durationSec: 40, description: "Decompress and lengthen the trunk rotators.", cues: ["tall spine", "breathe"] },
  },
  trunk_lean: {
    group: "trunk lean",
    more: {
      observation: "your torso leans further from vertical",
      cause: "excess lean shifts your balance point and can pull the swing off-plane",
      fix: "stack the torso more upright over a stable base",
      cue: "stack tall",
    },
    less: {
      observation: "your torso stays more upright than the pro's",
      cause: "too little lean can mean you aren't using forward posture/spine angle to set the swing plane",
      fix: "match the pro's spine angle by hinging slightly more from the hips",
      cue: "set the spine angle",
    },
    drill: "Posture-hold swings against a wall",
    mobilize: { name: "Cat-camel + thoracic extension", durationSec: 60, description: "Mobilize the spine into the working posture.", cues: ["segment by segment", "slow"] },
    strengthen: { name: "Plank with reach", sets: 3, reps: "30-40s", description: "Build the core stability to hold posture.", cues: ["flat back", "brace"] },
    stretch: { name: "Child's pose", durationSec: 40, description: "Decompress the spine after loading.", cues: ["sink hips", "breathe"] },
  },
  shoulder_line_tilt: {
    group: "shoulder line tilt",
    more: {
      observation: "your shoulders are more tilted (one higher than the other)",
      cause: "excess shoulder tilt usually means leaning away from the target and an unstable base",
      fix: "level the shoulders relative to the pro and keep the head centered",
      cue: "level the shoulders",
    },
    less: {
      observation: "your shoulders stay flatter/more level than the pro's",
      cause: "some sports need shoulder tilt to get under the ball or set the launch angle",
      fix: "allow the trail shoulder to drop slightly to match the pro's tilt",
      cue: "trail shoulder down",
    },
    drill: "Mirror posture checks",
    mobilize: { name: "Side-bend reaches", durationSec: 60, description: "Free the lateral trunk and shoulders.", cues: ["long side", "controlled"] },
    strengthen: { name: "Suitcase carry", sets: 3, reps: "30m/side", description: "Build anti-tilt lateral core strength.", cues: ["stay level", "ribs down"] },
    stretch: { name: "Overhead lat stretch", durationSec: 40, description: "Lengthen the lats and lateral trunk.", cues: ["reach long", "breathe"] },
  },
};

const SPORT_FLAVOR: Record<string, string> = {
  tennis: "Power flows from the legs up through trunk rotation into the racket arm.",
  basketball: "Repeatable shooting mechanics depend on vertical alignment and a clean wrist snap.",
  golf: "Sequencing — hips, then shoulders, then arms — is the largest source of distance.",
  baseball: "Explosive rotation and a firm front side turn lower-body load into bat or arm speed.",
  soccer: "Plant-foot placement and hip rotation set up a locked ankle at contact.",
  boxing: "Power comes off the rear foot through hip rotation into the lead knuckles.",
  volleyball: "Approach mechanics and shoulder range feed the wrist snap on the attack.",
  swimming: "A high-elbow catch and core-driven body roll drive propulsion.",
  custom: "Power depends on loading the body and releasing it in the right sequence.",
};

/**
 * Tennis-specific overlay. For tennis we replace the generic cause/fix/cue/drill
 * with stroke-relevant coaching language (kinetic chain, unit turn, X-factor,
 * contact-point extension). Anything not listed here falls back to the generic
 * KB above, and every other sport uses the generic KB unchanged. The numeric
 * `observation` is always kept generic so the guide stays grounded in the
 * measured angles. Scoped to tennis deliberately (see README coaching notes).
 */
type TennisDir = Partial<Pick<DirText, "cause" | "fix" | "cue">> & { drill?: string };
const TENNIS_OVERLAY: Record<string, Partial<Record<Dir, TennisDir>>> = {
  hip: {
    less: {
      cause: "standing too tall means the legs never load, so the stroke becomes all arm",
      fix: "sit into a deeper hip load during the unit turn, then drive up and through the ball",
      cue: "load the outside hip, then drive up",
      drill: "Loaded open-stance drives — coil onto the back hip and explode up into contact",
    },
    more: {
      fix: "stay a touch taller through the hips so you can rotate freely instead of squatting under the ball",
      cue: "tall hips, free rotation",
      drill: "Rotational shadow swings staying tall through the turn",
    },
  },
  knee: {
    less: {
      cause: "stiff, straight knees skip the leg drive that powers a modern groundstroke",
      fix: "add a clear knee bend in the load, then push up off the court through contact",
      cue: "bend to load, drive up",
      drill: "Split-step into a loaded knee bend, then an explosive shadow swing",
    },
  },
  trunk_rotation: {
    less: {
      cause: "an incomplete shoulder turn wastes the stretch-shorten 'X-factor' that whips the racket",
      fix: "complete the unit turn — coil the shoulders past the hips — before starting the forward swing",
      cue: "show your back to the net, then unwind",
      drill: "Unit-turn coil-and-fire reps with a racket or resistance band",
    },
    more: {
      fix: "let the hips and legs start the swing so the shoulders don't over-coil and arrive late",
      cue: "hips lead, shoulders follow",
      drill: "Hip-initiated rotation drill — fire the hip before the shoulder",
    },
  },
  trunk_lean: {
    less: {
      cause: "staying bolt upright keeps your weight back instead of driving forward into the shot",
      fix: "hinge slightly from the hips and get your chest moving forward through contact",
      cue: "lead with the chest into the ball",
      drill: "Hinge-and-drive groundstrokes stepping into the court",
    },
    more: {
      fix: "stack a little taller so you don't collapse over the ball and lose your base",
      cue: "stay tall over the base",
      drill: "Balance-hold finishes — hold the follow-through position for two counts",
    },
  },
  shoulder: {
    more: {
      cause: "carrying the arm too far from the body disconnects it from the trunk and strains the shoulder",
      fix: "keep the elbow closer with a more compact take-back so body rotation carries the racket",
      cue: "elbow in, let the body turn it",
      drill: "Compact take-back drill — keep the racket inside the body line on the backswing",
    },
    less: {
      cause: "too little arm separation shrinks the swing arc and the racket-head speed it can build",
      fix: "create more space between arm and torso in the take-back to lengthen the swing arc",
      cue: "make a bigger arc",
      drill: "Full-extension swings reaching through a long contact zone",
    },
  },
  elbow: {
    more: {
      cause: "an over-bent elbow at contact shortens the lever and leaks racket-head speed",
      fix: "extend the arm through the hitting zone so the racket reaches full speed at contact",
      cue: "long arm through contact",
      drill: "Contact-point extension drill — freeze a long arm at the strike",
    },
    less: {
      cause: "a locked, straight arm in the take-back removes the elastic whip the forearm needs",
      fix: "keep a relaxed bend in the take-back and let the forearm lag, then snap through contact",
      cue: "relaxed lag, snap late",
      drill: "Lag-and-snap shadow swings — feel the racket trail, then release",
    },
  },
};

interface ResolvedKnowledge {
  group: string;
  observation: string;
  cause: string;
  fix: string;
  cue: string;
  drill: string;
}

/** Effective coaching knowledge for a joint+direction, with the tennis overlay
 * applied on top of the generic KB when the sport is tennis. */
function resolveKnowledge(sportId: string, joint: JointName, dir: Dir): ResolvedKnowledge {
  const group = jointKey(joint);
  const k = KB[group];
  const base = dir === "more" ? k.more : k.less;
  const ov = sportId === "tennis" ? TENNIS_OVERLAY[group]?.[dir] : undefined;
  return {
    group: k.group,
    observation: base.observation,
    cause: ov?.cause ?? base.cause,
    fix: ov?.fix ?? base.fix,
    cue: ov?.cue ?? base.cue,
    drill: ov?.drill ?? k.drill,
  };
}

/** Keep only the most significant delta per body-part group (so a left and a
 * right knee don't both surface as separate, sometimes contradictory, issues).
 * Input should already be ordered by importance. */
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

/** The systematic, coachable gap for a joint: |signed bias| = |user mean − pro
 * mean|. This is what the guide reports as "the gap" (consistent with the
 * displayed means), not the noise-inflated mean abs delta. */
function gapDeg(d: JointDelta): number {
  return Math.abs(d.signedBiasDeg);
}

function numericClause(d: JointDelta): string {
  return `(you ${d.userMeanDeg}° vs pro ${d.proMeanDeg}°, about ${Math.round(gapDeg(d))}° ${d.signedBiasDeg >= 0 ? "more" : "less"})`;
}

/** Magnitude bucket so advice scales with how far off the user actually is. */
function severityWord(gap: number): string {
  if (gap >= 20) return "a major";
  if (gap >= 12) return "a clear";
  return "a small";
}

/** The phase in which this joint's systematic difference is largest, if the data
 * localizes it. */
function worstPhaseFor(joint: JointName, phases: PhaseSummary[]): string | null {
  let best: string | null = null;
  let bestVal = -1;
  for (const p of phases) {
    const hit = p.topDeltas.find((td) => td.joint === joint);
    if (hit && gapDeg(hit) > bestVal) {
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

function buildGuide(req: GuideRequest): ImprovementGuide {
  const { sport, shot, numericReport } = req;
  const deltas = numericReport.jointDeltas;
  const flagged = deltas.filter((d) => d.significance !== "low");
  // One issue per body-part group (worst side first) so left/right of the same
  // joint don't both surface as separate, sometimes contradictory, issues.
  // Rank by the overall systematic gap (|bias|). One issue per body-part group.
  const ranked = dedupeByGroup([...flagged].sort((a, b) => gapDeg(b) - gapDeg(a)));
  const top = ranked.slice(0, 4);

  const simPct = Math.round(numericReport.overallSimilarity * 100);
  const flavor = SPORT_FLAVOR[sport.id] ?? SPORT_FLAVOR.custom;

  const keyIssues = top.map((d) => {
    const dir: Dir = d.signedBiasDeg >= 0 ? "more" : "less";
    const t = resolveKnowledge(sport.id, d.joint, dir);
    const phase = worstPhaseFor(d.joint, numericReport.phases);
    const phaseClause = phase
      ? ` It shows up most during the ${phase.replace(/_/g, " ")} phase — focus your reps there.`
      : "";
    const priority = gapDeg(d) >= 20 ? "Prioritize this: " : "";
    return {
      title: `${titleCase(t.group)}: ${dir === "more" ? "too much" : "too little"} vs the pro`,
      joint: d.joint,
      observation: `${titleCase(t.observation)} ${numericClause(d)} — ${severityWord(gapDeg(d))} gap.`,
      cause: t.cause + ".",
      fix: `${priority}${t.fix}.${phaseClause}`,
    };
  });

  // Strengths: well-matched joints (smallest deltas), plus an overall note.
  const matched = dedupeByGroup(
    [...deltas].filter((d) => d.significance === "low").sort((a, b) => gapDeg(a) - gapDeg(b)),
  )
    .slice(0, 3)
    .map((d) => `Your ${KB[jointKey(d.joint)].group} closely matches the pro (within ${Math.round(gapDeg(d))}°).`);
  const strengths =
    matched.length > 0
      ? matched
      : [`Overall technique similarity is ${simPct}% — a solid base to build on.`];

  const cues = Array.from(
    new Set(top.map((d) => resolveKnowledge(sport.id, d.joint, d.signedBiasDeg >= 0 ? "more" : "less").cue)),
  ).slice(0, 6);

  const drills = Array.from(
    new Set(top.map((d) => resolveKnowledge(sport.id, d.joint, d.signedBiasDeg >= 0 ? "more" : "less").drill)),
  );

  // Count distinct body-part groups (after dedupe), not every left/right column,
  // so the summary matches the grouped issue list shown below it.
  const issueCount = ranked.length;
  const summary =
    issueCount === 0
      ? `Your ${shot} closely mirrors the pro at ${simPct}% overall similarity — no major mechanical gaps stood out. ${flavor} Keep reinforcing what's working and chase consistency.`
      : `Your ${shot} reaches ${simPct}% overall similarity to the pro, with ${issueCount} area${issueCount > 1 ? "s" : ""} worth addressing. The biggest is your ${titleCase(resolveKnowledge(sport.id, top[0].joint, top[0].signedBiasDeg >= 0 ? "more" : "less").group)} (${Math.round(gapDeg(top[0]))}° off). ${flavor}`;

  return { summary, strengths, keyIssues, drills, cues };
}

function buildWorkouts(req: GuideRequest): Workout[] {
  const { sport, shot, numericReport } = req;
  const flagged = numericReport.jointDeltas
    .filter((d) => d.significance !== "low")
    .sort((a, b) => gapDeg(b) - gapDeg(a));
  // One target per body-part group; if nothing flagged, target the largest
  // deltas anyway so the workouts are still useful.
  const targets = dedupeByGroup(flagged.length > 0 ? flagged : numericReport.jointDeltas).slice(0, 3);
  const highCount = numericReport.jointDeltas.filter((d) => d.significance === "high").length;
  const difficulty: Workout["difficulty"] =
    highCount >= 2 ? "advanced" : highCount === 1 ? "intermediate" : "beginner";

  const targetKnowledge = targets.map((d) => ({
    d,
    k: KB[jointKey(d.joint)],
    r: resolveKnowledge(sport.id, d.joint, d.signedBiasDeg >= 0 ? "more" : "less"),
  }));
  const targetsJoints = Array.from(new Set(targets.map((d) => d.joint)));
  const dur = (steps: WorkoutStep[]): number =>
    Math.max(
      10,
      Math.round(
        steps.reduce(
          (m, s) => m + (s.durationSec ? s.durationSec / 60 : (s.sets ?? 3) * 1.5),
          0,
        ),
      ),
    );

  // 1. Mobility & activation.
  const w1Warm = targetKnowledge.map((t) => t.k.mobilize).slice(0, 3);
  const w1Main = targetKnowledge.map((t) => t.k.strengthen).slice(0, 1);
  const w1Cool = targetKnowledge.map((t) => t.k.stretch).slice(0, 2);
  const workout1: Workout = {
    id: slug([sport.id, shot, "mobility"]),
    title: "Mobility & activation",
    focus: `Free up and prime the joints flagged in your ${shot}.`,
    durationMin: dur([...w1Warm, ...w1Main, ...w1Cool]),
    difficulty: "beginner",
    equipment: ["resistance band"],
    warmup: w1Warm,
    main: w1Main,
    cooldown: w1Cool,
    targetsJoints,
    notes: "Do this on training days before skill work.",
  };

  // 2. Corrective strength.
  const w2Warm: WorkoutStep[] = [
    { name: "Dynamic full-body warm-up", durationSec: 300, description: "Light cardio plus the mobility drills above.", cues: ["raise heart rate", "move through range"] },
  ];
  const w2Main = targetKnowledge.map((t) => t.k.strengthen);
  const w2Cool = targetKnowledge.map((t) => t.k.stretch).slice(0, 2);
  const workout2: Workout = {
    id: slug([sport.id, shot, "strength"]),
    title: "Corrective strength",
    focus: `Build strength where your mechanics differ most from the pro.`,
    durationMin: dur([...w2Warm, ...w2Main, ...w2Cool]),
    difficulty,
    equipment: ["dumbbells", "cable or band", "bench"],
    warmup: w2Warm,
    main: w2Main,
    cooldown: w2Cool,
    targetsJoints,
    notes: "2–3× per week with a day of recovery between sessions.",
  };

  // 3. Skill & sequencing — turns the corrections into the actual motion.
  const phaseNote =
    numericReport.phases.length > 0
      ? `Pay attention to the ${numericReport.phases
          .map((p) => p.name.replace(/_/g, " "))
          .join(" → ")} sequence.`
      : "Rehearse the full motion slowly, then build speed.";
  const skillCues = Array.from(new Set(targetKnowledge.map((t) => t.r.cue)));
  const w3Main: WorkoutStep[] = targetKnowledge.map((t) => ({
    name: t.r.drill,
    sets: 4,
    reps: "6-8",
    description: `Rehearse the correction for your ${t.r.group} with intent.`,
    cues: [t.r.cue],
  }));
  const workout3: Workout = {
    id: slug([sport.id, shot, "skill"]),
    title: "Skill & sequencing",
    focus: `Transfer the corrections into your ${sport.name.toLowerCase()} ${shot.toLowerCase()}.`,
    durationMin: dur([...w2Warm, ...w3Main]),
    difficulty,
    equipment: ["medicine ball", "your normal gear"],
    warmup: [
      { name: "Shadow reps", durationSec: 180, description: `Slow-motion ${shot} reps focusing on the cues.`, cues: skillCues.slice(0, 3) },
    ],
    main: w3Main,
    cooldown: [
      { name: "Easy mobility flush", durationSec: 120, description: "Gentle movement to cool down.", cues: ["relax", "breathe"] },
    ],
    targetsJoints,
    notes: phaseNote,
  };

  return [workout1, workout2, workout3];
}

export function generateGuideAndWorkouts(req: GuideRequest): GuideResponse {
  return { guide: buildGuide(req), workouts: buildWorkouts(req) };
}
