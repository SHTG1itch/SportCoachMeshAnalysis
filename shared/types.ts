// Shared contracts between Electron main and renderer.
// Plain data only — no runtime deps.

export type MediaKind = "image" | "video";

export type SportId =
  | "tennis"
  | "basketball"
  | "golf"
  | "baseball"
  | "soccer"
  | "boxing"
  | "volleyball"
  | "swimming"
  | "custom";

export interface SportMeta {
  id: SportId;
  name: string;
  shots: string[]; // e.g. ["Forehand", "Backhand", "Serve"]
  keyJoint: JointName; // drives phase detection
  description: string;
}

export type JointName =
  | "left_shoulder"
  | "right_shoulder"
  | "left_elbow"
  | "right_elbow"
  | "left_wrist"
  | "right_wrist"
  | "left_hip"
  | "right_hip"
  | "left_knee"
  | "right_knee"
  | "left_ankle"
  | "right_ankle"
  | "trunk_rotation"
  | "hip_rotation"
  | "shoulder_line_tilt";

export interface JointDelta {
  joint: JointName;
  label: string;
  meanDeltaDeg: number;
  maxDeltaDeg: number;
  proMeanDeg: number;
  userMeanDeg: number;
  /** +ve means user is over-rotated vs pro; -ve under-rotated. */
  signedBiasDeg: number;
  significance: "low" | "medium" | "high";
}

export interface PhaseSummary {
  name: string; // e.g. "preparation", "load", "contact", "follow_through"
  startFrame: number;
  endFrame: number;
  topDeltas: JointDelta[];
  note?: string;
}

export interface AnalysisReport {
  version: 1;
  sport: SportMeta;
  shot: string;
  mode: "sequence" | "single_frame";
  proFps: number;
  userFps: number;
  proFrameCount: number;
  userFrameCount: number;
  durationSecPro: number;
  durationSecUser: number;
  alignment: {
    /** For sequence mode: pairs of (proIdx, userIdx) along DTW path. */
    path: [number, number][];
    /** Normalized DTW distance (lower = more similar motion). */
    distance: number;
    /** Per-frame similarity 0..1 averaged across joints. */
    similarityTimeline: number[];
  } | null;
  /** For single_frame mode: the user frame index that best matched the pro image. */
  keyUserFrame: number | null;
  overallSimilarity: number; // 0..1
  jointDeltas: JointDelta[];
  phases: PhaseSummary[];
  /** LLM-authored content derived from the numeric report. */
  guide: ImprovementGuide | null;
  workouts: Workout[];
}

export interface ImprovementGuide {
  summary: string;
  strengths: string[];
  keyIssues: {
    title: string;
    joint?: JointName;
    observation: string;
    cause: string;
    fix: string;
  }[];
  drills: string[]; // names only; full workouts live in `workouts`
  cues: string[]; // in-the-moment mental cues
}

export interface Workout {
  id: string;
  title: string;
  focus: string;
  durationMin: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  equipment: string[];
  warmup: WorkoutStep[];
  main: WorkoutStep[];
  cooldown: WorkoutStep[];
  targetsJoints: JointName[];
  notes?: string;
}

export interface WorkoutStep {
  name: string;
  sets?: number;
  reps?: string;
  durationSec?: number;
  description: string;
  cues?: string[];
}

// ---- Persistence records ----

export interface AnalysisRecord {
  id: string;
  createdAt: string; // ISO
  sportId: SportId;
  shot: string;
  thumbnailDataUrl?: string;
  report: AnalysisReport;
}

export interface SavedWorkout {
  id: string;
  savedAt: string; // ISO
  analysisId?: string;
  workout: Workout;
  tags: string[];
}

// ---- IPC contract (preload-exposed API) ----

export interface AppApi {
  // Analysis persistence
  saveAnalysis(record: AnalysisRecord): Promise<void>;
  listAnalyses(): Promise<AnalysisRecord[]>;
  getAnalysis(id: string): Promise<AnalysisRecord | null>;
  deleteAnalysis(id: string): Promise<void>;

  // Workouts
  saveWorkout(w: SavedWorkout): Promise<void>;
  listWorkouts(): Promise<SavedWorkout[]>;
  deleteWorkout(id: string): Promise<void>;

  // LLM
  generateGuideAndWorkouts(req: GuideRequest): Promise<GuideResponse>;

  // Settings
  getSettings(): Promise<AppSettings>;
  setSettings(s: Partial<AppSettings>): Promise<AppSettings>;

  // Utility
  openExternal(url: string): Promise<void>;
}

export interface GuideRequest {
  sport: SportMeta;
  shot: string;
  numericReport: {
    overallSimilarity: number;
    jointDeltas: JointDelta[];
    phases: PhaseSummary[];
    mode: "sequence" | "single_frame";
  };
}

export interface GuideResponse {
  guide: ImprovementGuide;
  workouts: Workout[];
}

export interface AppSettings {
  anthropicApiKey: string | null;
  model: string;
  theme: "dark" | "light";
}

declare global {
  interface Window {
    app: AppApi;
  }
}
