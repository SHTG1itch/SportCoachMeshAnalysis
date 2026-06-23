import { ipcMain } from "electron";
import {
  deleteAnalysis,
  deleteWorkout,
  getAnalysis,
  getSettings,
  listAnalyses,
  listWorkouts,
  saveAnalysis,
  saveWorkout,
  setSettings,
} from "./db";
import { openExternalSafely } from "./safeOpen";
import type {
  AnalysisRecord,
  AppSettings,
  SavedWorkout,
  SportId,
} from "../shared/types";

// ---------------------------------------------------------------------------
// IPC input validation.
//
// IPC is the trust boundary in Electron: TypeScript types are erased at runtime,
// so a compromised or buggy renderer can send any shape. We validate every
// payload here before it reaches the DB — enforcing enums (theme, sportId),
// bounding string/payload sizes (so a renderer can't fill the disk), and
// rejecting malformed records — rather than trusting the renderer's types.
// ---------------------------------------------------------------------------

const MAX_ID = 256;
const MAX_SHOT = 256;
const MAX_THUMB = 4 * 1024 * 1024; // a pose thumbnail data URL
const MAX_PAYLOAD = 12 * 1024 * 1024; // a full AnalysisReport / Workout, JSON

const SPORT_IDS: ReadonlySet<string> = new Set<SportId>([
  "tennis", "basketball", "golf", "baseball", "soccer", "boxing",
  "volleyball", "swimming", "custom",
]);
const THEMES: ReadonlySet<string> = new Set(["dark", "light"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max: number, field: string): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) {
    throw new Error(`Invalid IPC payload: ${field}`);
  }
  return v;
}

/** Reject anything whose JSON serialization exceeds `max` bytes. */
function boundedJson(v: unknown, max: number, field: string): void {
  if (JSON.stringify(v).length > max) {
    throw new Error(`IPC payload too large: ${field}`);
  }
}

function validateAnalysis(r: unknown): AnalysisRecord {
  if (!isObj(r)) throw new Error("Invalid IPC payload: analysis record");
  str(r.id, MAX_ID, "id");
  str(r.createdAt, MAX_ID, "createdAt");
  if (!SPORT_IDS.has(r.sportId as string)) throw new Error("Invalid IPC payload: sportId");
  str(r.shot, MAX_SHOT, "shot");
  if (r.thumbnailDataUrl !== undefined) {
    if (typeof r.thumbnailDataUrl !== "string" || r.thumbnailDataUrl.length > MAX_THUMB) {
      throw new Error("Invalid IPC payload: thumbnailDataUrl");
    }
  }
  if (!isObj(r.report)) throw new Error("Invalid IPC payload: report");
  boundedJson(r.report, MAX_PAYLOAD, "report");
  return r as unknown as AnalysisRecord;
}

function validateWorkout(w: unknown): SavedWorkout {
  if (!isObj(w)) throw new Error("Invalid IPC payload: workout record");
  str(w.id, MAX_ID, "id");
  str(w.savedAt, MAX_ID, "savedAt");
  if (w.analysisId !== undefined && typeof w.analysisId !== "string") {
    throw new Error("Invalid IPC payload: analysisId");
  }
  if (!Array.isArray(w.tags) || w.tags.some((t) => typeof t !== "string")) {
    throw new Error("Invalid IPC payload: tags");
  }
  if (!isObj(w.workout)) throw new Error("Invalid IPC payload: workout");
  boundedJson(w.workout, MAX_PAYLOAD, "workout");
  return w as unknown as SavedWorkout;
}

function validateSettings(s: unknown): Partial<AppSettings> {
  if (!isObj(s)) throw new Error("Invalid IPC payload: settings");
  if (s.theme !== undefined && !THEMES.has(s.theme as string)) {
    throw new Error("Invalid IPC payload: theme");
  }
  return s.theme !== undefined ? { theme: s.theme as AppSettings["theme"] } : {};
}

export function registerIpcHandlers(): void {
  ipcMain.handle("analysis:save", (_e, r: unknown) => saveAnalysis(validateAnalysis(r)));
  ipcMain.handle("analysis:list", () => listAnalyses());
  ipcMain.handle("analysis:get", (_e, id: unknown) => getAnalysis(str(id, MAX_ID, "id")));
  ipcMain.handle("analysis:delete", (_e, id: unknown) => deleteAnalysis(str(id, MAX_ID, "id")));

  ipcMain.handle("workout:save", (_e, w: unknown) => saveWorkout(validateWorkout(w)));
  ipcMain.handle("workout:list", () => listWorkouts());
  ipcMain.handle("workout:delete", (_e, id: unknown) => deleteWorkout(str(id, MAX_ID, "id")));

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, s: unknown) => setSettings(validateSettings(s)));

  ipcMain.handle("shell:open", async (_e, url: unknown) => {
    if (typeof url !== "string") throw new Error("Invalid IPC payload: url");
    await openExternalSafely(url);
  });
}
