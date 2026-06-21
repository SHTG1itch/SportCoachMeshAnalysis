import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import { WorkoutCard } from "../components/WorkoutCard";

export function WorkoutsLibrary() {
  const workouts = useStore((s) => s.workouts);
  const refresh = useStore((s) => s.refresh);
  const loaded = useStore((s) => s.loaded);
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
    } finally {
      setConfirmId(null);
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

      <div className="card p-3 flex items-center gap-3">
        <Search size={16} className="text-ink-400 ml-2" />
        <input
          className="bg-transparent flex-1 outline-none text-sm placeholder:text-ink-400"
          placeholder="Search by sport, shot, focus…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!loaded ? (
        <div className="card p-8 text-center text-sm text-ink-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-400">
          {workouts.length === 0
            ? "You haven't saved any workouts yet. Run an analysis and save the ones that target what you want to work on."
            : "No workouts match your search."}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((w) => (
            <div key={w.id} className="relative">
              <WorkoutCard workout={w.workout} saved onSave={() => setConfirmId(w.id)} />
              <div className="absolute top-5 right-36 text-[11px] text-ink-400 flex gap-1">
                {w.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
              {confirmId === w.id ? (
                <div className="absolute top-5 right-5 flex items-center gap-2">
                  <button
                    onClick={() => del(w.id)}
                    className="text-xs font-medium text-bad hover:underline"
                  >
                    Confirm remove
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-ink-400 hover:text-ink-100"
                    aria-label="Cancel remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(w.id)}
                  className="absolute top-5 right-5 text-ink-400 hover:text-bad"
                  title="Remove from library"
                  aria-label={`Remove ${w.workout.title} from library`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
