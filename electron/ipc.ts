import { ipcMain, BrowserWindow } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
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
} from "../shared/types";
import {
  isAnalysisReport,
  isSportId,
  isTheme,
  isWorkout,
} from "../shared/validation";

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
  if (Buffer.byteLength(JSON.stringify(v), "utf8") > max) {
    throw new Error(`IPC payload too large: ${field}`);
  }
}

function validateAnalysis(r: unknown): AnalysisRecord {
  if (!isObj(r)) throw new Error("Invalid IPC payload: analysis record");
  str(r.id, MAX_ID, "id");
  str(r.createdAt, MAX_ID, "createdAt");
  if (!isSportId(r.sportId)) throw new Error("Invalid IPC payload: sportId");
  str(r.shot, MAX_SHOT, "shot");
  if (r.thumbnailDataUrl !== undefined) {
    if (typeof r.thumbnailDataUrl !== "string" || r.thumbnailDataUrl.length > MAX_THUMB) {
      throw new Error("Invalid IPC payload: thumbnailDataUrl");
    }
  }
  if (!isAnalysisReport(r.report)) throw new Error("Invalid IPC payload: report");
  if (r.report.sport.id !== r.sportId || r.report.shot !== r.shot) {
    throw new Error("Invalid IPC payload: inconsistent analysis metadata");
  }
  boundedJson(r.report, MAX_PAYLOAD, "report");
  return r as unknown as AnalysisRecord;
}

function validateWorkout(w: unknown): SavedWorkout {
  if (!isObj(w)) throw new Error("Invalid IPC payload: workout record");
  str(w.id, MAX_ID, "id");
  str(w.savedAt, MAX_ID, "savedAt");
  if (w.analysisId !== undefined) str(w.analysisId, MAX_ID, "analysisId");
  if (!Array.isArray(w.tags) || w.tags.some((t) => typeof t !== "string")) {
    throw new Error("Invalid IPC payload: tags");
  }
  // Bound the tag array like every other persisted payload — string-typed but
  // unbounded tags were the one disk-fill vector this module didn't cap.
  boundedJson(w.tags, 16 * 1024, "tags");
  if (!isWorkout(w.workout)) throw new Error("Invalid IPC payload: workout");
  boundedJson(w.workout, MAX_PAYLOAD, "workout");
  return w as unknown as SavedWorkout;
}

function validateSettings(s: unknown): Partial<AppSettings> {
  if (!isObj(s)) throw new Error("Invalid IPC payload: settings");
  if (s.theme !== undefined && !isTheme(s.theme)) {
    throw new Error("Invalid IPC payload: theme");
  }
  return s.theme !== undefined ? { theme: s.theme } : {};
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

  // Window controls for the frameless window. Each message acts on the sender's
  // OWN window (resolved from the WebContents) rather than a shared reference, so
  // it stays correct if the app ever opens more than one window. No payload
  // crosses the boundary, so there is nothing to validate.
  const senderWindow = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender);

  ipcMain.on("window:minimize", (e) => senderWindow(e)?.minimize());
  ipcMain.on("window:toggle-maximize", (e) => {
    const w = senderWindow(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on("window:close", (e) => senderWindow(e)?.close());
  ipcMain.handle("window:is-maximized", (e) => senderWindow(e)?.isMaximized() ?? false);
}
