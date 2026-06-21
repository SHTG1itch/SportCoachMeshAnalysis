import { ArrowRight, Dumbbell, Plus, Target, Timer } from "lucide-react";
import { SPORTS } from "../lib/sports";
import { useStore } from "../store";

export function Home() {
  const go = useStore((s) => s.go);
  const analyses = useStore((s) => s.analyses);
  const workouts = useStore((s) => s.workouts);
  const loaded = useStore((s) => s.loaded);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="h1">Train against the pros.</h1>
        <p className="mt-2 text-ink-300 max-w-xl">
          Upload a pro's technique and a clip of your own. Mesh Coach rebuilds a 3D skeleton
          for each, compares every joint frame-by-frame, and writes you a specific coaching
          plan.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button onClick={() => go({ name: "new" })} className="btn-primary">
            <Plus size={14} /> New analysis
          </button>
          <button onClick={() => go({ name: "workouts" })} className="btn-ghost">
            <Dumbbell size={14} /> My workouts
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="h2">Pick a sport to start</div>
          <button
            onClick={() => go({ name: "new" })}
            className="text-sm text-accent-400 hover:text-accent-300 flex items-center gap-1"
          >
            Open full picker <ArrowRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {SPORTS.slice(0, 8).map((s) => (
            <button
              key={s.id}
              onClick={() => go({ name: "new", sportId: s.id })}
              className="card p-4 text-left hover:border-accent-500/40 transition-colors"
            >
              <div className="text-base font-semibold text-ink-50">{s.name}</div>
              <div className="text-xs text-ink-400 mt-1">{s.shots.length} motions</div>
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Timer size={16} className="text-accent-400" />
            <div className="h3 m-0">Recent analyses</div>
          </div>
          {!loaded ? (
            <div className="text-sm text-ink-400">Loading…</div>
          ) : analyses.length === 0 ? (
            <div className="text-sm text-ink-400">
              You haven't run an analysis yet. Start one to see it here.
            </div>
          ) : (
            <ul className="space-y-2">
              {analyses.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => go({ name: "analysis", record: a, from: "home" })}
                    className="w-full flex items-center justify-between gap-3 text-left rounded-lg px-3 py-2 hover:bg-white/5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {a.thumbnailDataUrl && (
                        <img
                          src={a.thumbnailDataUrl}
                          alt=""
                          className="h-10 w-10 rounded-md bg-canvas-900 object-contain shrink-0 border border-white/5"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink-50 truncate">
                          {a.report.sport.name} · {a.shot}
                        </div>
                        <div className="text-xs text-ink-400">
                          {new Date(a.createdAt).toLocaleString()} · similarity{" "}
                          {(a.report.overallSimilarity * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={14} className="text-ink-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-ok" />
            <div className="h3 m-0">Saved workouts</div>
          </div>
          {!loaded ? (
            <div className="text-sm text-ink-400">Loading…</div>
          ) : workouts.length === 0 ? (
            <div className="text-sm text-ink-400">
              Workouts generated from your analyses will live here once you save them.
            </div>
          ) : (
            <ul className="space-y-2">
              {workouts.slice(0, 5).map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-ink-50">{w.workout.title}</div>
                    <div className="text-xs text-ink-400">
                      {w.workout.durationMin} min · {w.workout.difficulty}
                    </div>
                  </div>
                  <button
                    onClick={() => go({ name: "workouts" })}
                    className="text-xs text-accent-400 hover:text-accent-300"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
