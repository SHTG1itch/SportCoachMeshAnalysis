import { create } from "zustand";
import type {
  AnalysisRecord,
  AppSettings,
  SavedWorkout,
} from "@shared/types";

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "analysis"; record: AnalysisRecord }
  | { name: "workouts" }
  | { name: "history" }
  | { name: "settings" };

interface State {
  route: Route;
  analyses: AnalysisRecord[];
  workouts: SavedWorkout[];
  settings: AppSettings | null;

  go(route: Route): void;
  refresh(): Promise<void>;
  refreshSettings(): Promise<void>;
}

export const useStore = create<State>((set) => ({
  route: { name: "home" },
  analyses: [],
  workouts: [],
  settings: null,

  go: (route) => set({ route }),

  refresh: async () => {
    const [analyses, workouts] = await Promise.all([
      window.app.listAnalyses(),
      window.app.listWorkouts(),
    ]);
    set({ analyses, workouts });
  },

  refreshSettings: async () => {
    const settings = await window.app.getSettings();
    set({ settings });
  },
}));
