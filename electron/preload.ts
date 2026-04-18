import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalysisRecord,
  AppApi,
  AppSettings,
  GuideRequest,
  GuideResponse,
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

  generateGuideAndWorkouts: (req: GuideRequest): Promise<GuideResponse> =>
    ipcRenderer.invoke("llm:guide", req),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s: Partial<AppSettings>) => ipcRenderer.invoke("settings:set", s),

  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
};

contextBridge.exposeInMainWorld("app", api);
