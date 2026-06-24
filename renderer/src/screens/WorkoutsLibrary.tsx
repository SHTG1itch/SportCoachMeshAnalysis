import { useMemo, useState } from "react";
import { Dumbbell, Search } from "lucide-react";
import { useStore } from "../store";
import { WorkoutCard } from "../components/WorkoutCard";

export function WorkoutsLibrary() {
  const workouts = useStore((s) => s.workouts);
  const refresh = useStore((s) => s.refresh);
  const loaded = useStore((s) => s.loaded);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workouts;
    return workouts.filter((w) => {
      return (
        w.workout.title.toLowerCase().includes(q) ||
        w.workout.focus.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [workouts, query]);

  const del = async (id: string) => {
    try {
      await window.app.deleteWorkout(id);
      await refresh();
    } catch (e) {
      console.error("Failed to delete workout:", e);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Workout library</h1>
        <p className="mt-2 text-ink-300">
          Training sessions saved from your analyses. Open any to see the full set.
        </p>
      </div>

      <div className="card flex items-center gap-2 px-3 py-2 focus-within:ring-2 focus-within:ring-accent-500/30">
        <Search size={16} className="text-ink-400 shrink-0" />
        <input
          className="bg-transparent flex-1 outline-none text-sm text-ink-50 placeholder:text-ink-400"
          placeholder="Search by sport, shot, focus…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search saved workouts"
        />
      </div>

      {!loaded ? (
        <div className="card p-8 text-center text-sm text-ink-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 flex flex-col items-center gap-3 text-center">
          <div className="h-11 w-11 rounded-full bg-white/5 flex items-center justify-center text-ink-400">
            {workouts.length === 0 ? <Dumbbell size={20} /> : <Search size={20} />}
          </div>
          <div className="text-sm text-ink-400 max-w-sm">
            {workouts.length === 0
              ? "You haven't saved any workouts yet. Run an analysis and save the ones that target what you want to work on."
              : "No workouts match your search."}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w.workout}
              saved
              tags={w.tags}
              onRemove={() => del(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
