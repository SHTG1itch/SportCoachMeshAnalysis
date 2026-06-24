import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalysisRecord,
  AppApi,
  AppSettings,
  SavedWorkout,
} from "../shared/types";

const api: AppApi = {
  saveAnalysis: (r: AnalysisRecord) => ipcRenderer.invoke("analysis:save", r),
  listAnalyses: () => ipcRenderer.invoke("analysis:list"),
  getAnalysis: (id: string) => ipcRenderer.invoke("analysis:get", id),
  deleteAnalysis: (id: string) => ipcRenderer.invoke("analysis:delete", id),

  saveWorkout: (w: SavedWorkout) => ipcRenderer.invoke("workout:save", w),
  listWorkouts: () => ipcRenderer.invoke("workout:list"),
  deleteWorkout: (id: string) => ipcRenderer.invoke("workout:delete", id),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: Partial<AppSettings>) => ipcRenderer.invoke("settings:set", s),

  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),

  // The host OS family, so the renderer can pick platform-correct window chrome:
  // it draws its own caption buttons on Windows/Linux (no native title bar) and
  // defers to the native traffic lights on macOS.
  platform: process.platform,

  window: {
    // Fire-and-forget actions — no payload crosses the boundary, so there is
    // nothing to validate; the main process resolves the sender's own window.
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizeChange: (cb: (isMaximized: boolean) => void) => {
      const listener = (_e: unknown, isMaximized: boolean) => cb(isMaximized);
      ipcRenderer.on("window:maximize-changed", listener);
      return () => ipcRenderer.removeListener("window:maximize-changed", listener);
    },
  },
};

contextBridge.exposeInMainWorld("app", api);
