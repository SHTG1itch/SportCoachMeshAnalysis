import { useStore } from "../store";

const LABELS: Record<string, string> = {
  home: "Home",
  new: "New Analysis",
  analysis: "Analysis Result",
  workouts: "Workout Library",
  history: "History",
  settings: "Settings",
};

export function TopBar() {
  const route = useStore((s) => s.route);
  return (
    <div className="drag h-11 border-b border-white/5 flex items-center px-6">
      <div className="text-xs uppercase tracking-[0.18em] text-ink-400">
        {LABELS[route.name] ?? "Mesh Coach"}
      </div>
    </div>
  );
}
