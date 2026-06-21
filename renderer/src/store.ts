import { create } from "zustand";
import type {
  AnalysisRecord,
  AppSettings,
  SportId,
  SavedWorkout,
} from "@shared/types";

export type RouteName =
  | "home"
  | "new"
  | "analysis"
  | "workouts"
  | "history"
  | "settings";

export type Route =
  | { name: "home" }
  // Optional sportId lets the Home sport cards open New Analysis with that sport
  // already selected.
  | { name: "new"; sportId?: SportId }
  // `from` records where the result was opened from so Back returns there
  // (History → result → Back should go to History, not always Home).
  | { name: "analysis"; record: AnalysisRecord; from?: "home" | "history" }
  | { name: "workouts" }
  | { name: "history" }
  | { name: "settings" };

interface State {
  route: Route;
  analyses: AnalysisRecord[];
  workouts: SavedWorkout[];
  settings: AppSettings | null;
  /** False until the first data load resolves (success OR failure), so screens
   * can distinguish "still loading" from "genuinely empty". */
  loaded: boolean;
  /** Set when a data load fails, so the UI can surface it instead of silently
   * showing empty lists. */
  error: string | null;

  go(route: Route): void;
  refresh(): Promise<void>;
  refreshSettings(): Promise<void>;
}

export const useStore = create<State>((set) => ({
  route: { name: "home" },
  analyses: [],
  workouts: [],
  settings: null,
  loaded: false,
  error: null,

  go: (route) => set({ route }),

  refresh: async () => {
    try {
      const [analyses, workouts] = await Promise.all([
        window.app.listAnalyses(),
        window.app.listWorkouts(),
      ]);
      set({ analyses, workouts, loaded: true, error: null });
    } catch (e) {
      // Don't let a persistence failure become an unhandled rejection that
      // leaves the UI silently stale; record it and mark loaded so screens stop
      // showing the loading state.
      console.error("Failed to load saved data:", e);
      set({
        loaded: true,
        error: e instanceof Error ? e.message : "Could not load your saved data.",
      });
    }
  },

  refreshSettings: async () => {
    try {
      const settings = await window.app.getSettings();
      set({ settings });
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  },
}));
