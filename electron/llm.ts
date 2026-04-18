import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "./db";
import type {
  GuideRequest,
  GuideResponse,
  ImprovementGuide,
  Workout,
} from "../shared/types";

function client(): Anthropic {
  const { anthropicApiKey } = getSettings();
  const key = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "No Anthropic API key configured. Add one in Settings or set ANTHROPIC_API_KEY.",
    );
  }
  return new Anthropic({ apiKey: key });
}

const SYSTEM_PROMPT = `You are an expert biomechanics and sports-performance coach.
You will receive a numeric technique-comparison report between a user and a professional
athlete, produced from 3D pose estimation. Use the numbers as ground truth — do not
invent joint angles that are not in the data.

Your job has two parts:
1. Produce an improvement guide that is specific, mechanical, and actionable. Tie each
   issue to the joint data provided.
2. Produce 3 to 4 training workouts the user can save and repeat. They must target the
   specific joint deltas flagged as high-significance, be appropriate to the sport and
   shot, and follow a warmup / main / cooldown structure with concrete sets/reps/cues.

Return ONLY valid JSON matching the schema the user will provide. No prose, no markdown
fences, no commentary outside the JSON.`;

const SCHEMA_HINT = `{
  "guide": {
    "summary": "string — 2 or 3 sentences giving the big picture",
    "strengths": ["string"],
    "keyIssues": [
      {
        "title": "string",
        "joint": "optional joint name from the data",
        "observation": "what the numbers show",
        "cause": "biomechanical reason",
        "fix": "specific instruction to correct it"
      }
    ],
    "drills": ["short drill name"],
    "cues": ["short mental cue — 3 to 6 words"]
  },
  "workouts": [
    {
      "id": "slug-style-string",
      "title": "string",
      "focus": "one-line focus statement",
      "durationMin": 20,
      "difficulty": "beginner" | "intermediate" | "advanced",
      "equipment": ["string"],
      "warmup": [{"name": "string", "durationSec": 60, "description": "string", "cues": ["string"]}],
      "main": [{"name": "string", "sets": 3, "reps": "8-10", "description": "string", "cues": ["string"]}],
      "cooldown": [{"name": "string", "durationSec": 60, "description": "string"}],
      "targetsJoints": ["joint name from data"],
      "notes": "optional"
    }
  ]
}`;

function buildUserMessage(req: GuideRequest): string {
  const { sport, shot, numericReport } = req;
  const payload = {
    sport: sport.name,
    shot,
    mode: numericReport.mode,
    overallSimilarity: numericReport.overallSimilarity,
    highSignificanceDeltas: numericReport.jointDeltas.filter(
      (d) => d.significance === "high",
    ),
    mediumSignificanceDeltas: numericReport.jointDeltas.filter(
      (d) => d.significance === "medium",
    ),
    phases: numericReport.phases.map((p) => ({
      name: p.name,
      topDeltas: p.topDeltas,
      note: p.note,
    })),
  };
  return `Sport: ${sport.name}
Shot / skill: ${shot}
Sport description: ${sport.description}

Numeric technique comparison (positive signedBiasDeg means user is MORE rotated/flexed than pro; negative means LESS):
${JSON.stringify(payload, null, 2)}

Return JSON matching this schema exactly:
${SCHEMA_HINT}`;
}

function extractJson(raw: string): unknown {
  // Strip any stray markdown fences just in case the model adds them.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("LLM response did not contain a JSON object");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function generateGuideAndWorkouts(
  req: GuideRequest,
): Promise<GuideResponse> {
  const c = client();
  const { model } = getSettings();
  const resp = await c.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(req) }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text) as {
    guide: ImprovementGuide;
    workouts: Workout[];
  };

  if (!parsed.guide || !Array.isArray(parsed.workouts)) {
    throw new Error("LLM response did not match expected schema");
  }
  return { guide: parsed.guide, workouts: parsed.workouts };
}
