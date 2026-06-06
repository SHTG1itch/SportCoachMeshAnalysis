import { ipcMain, shell } from "electron";
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
import type {
  AnalysisRecord,
  AppSettings,
  SavedWorkout,
} from "../shared/types";

export function registerIpcHandlers(): void {
  ipcMain.handle("analysis:save", (_e, r: AnalysisRecord) => saveAnalysis(r));
  ipcMain.handle("analysis:list", () => listAnalyses());
  ipcMain.handle("analysis:get", (_e, id: string) => getAnalysis(id));
  ipcMain.handle("analysis:delete", (_e, id: string) => deleteAnalysis(id));

  ipcMain.handle("workout:save", (_e, w: SavedWorkout) => saveWorkout(w));
  ipcMain.handle("workout:list", () => listWorkouts());
  ipcMain.handle("workout:delete", (_e, id: string) => deleteWorkout(id));

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, s: Partial<AppSettings>) => setSettings(s));

  ipcMain.handle("shell:open", async (_e, url: string) => {
    await shell.openExternal(url);
  });
}
