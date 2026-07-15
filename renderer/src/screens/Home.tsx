import {
  ArrowRight,
  ArrowUpRight,
  Dumbbell,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Timer,
  Waypoints,
} from "lucide-react";
import { SPORTS } from "../lib/sports";
import { useStore } from "../store";

export function Home() {
  const go = useStore((s) => s.go);
  const analyses = useStore((s) => s.analyses);
  const workouts = useStore((s) => s.workouts);
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);

  return (
    <div className="space-y-9">
      <section className="hero-panel p-7 md:p-9" aria-labelledby="home-heading">
        <div className="relative z-10 grid gap-8 xl:grid-cols-[1.25fr_0.75fr] xl:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-500/25 bg-accent-500/10 px-3 py-1 text-xs font-medium text-accent-400">
              <ScanLine size={13} aria-hidden="true" /> Private, on-device motion intelligence
            </div>
            <h1 id="home-heading" className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-ink-50 md:text-5xl">
              See your technique through a coach's eyes.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-300">
              Compare your movement with a professional reference. Mesh Coach reconstructs
              both athletes in 3D, aligns the motion frame by frame, and turns the difference
              into a focused training plan.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={() => go({ name: "new" })} className="btn-primary px-5 py-2.5">
                Start an analysis <ArrowRight size={15} aria-hidden="true" />
              </button>
              <button onClick={() => go({ name: "workouts" })} className="btn-ghost px-5 py-2.5">
                <Dumbbell size={15} aria-hidden="true" /> My workouts
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 xl:grid-cols-1" aria-label="How analysis works">
            {[
              { step: "01", title: "Capture", detail: "Add two clear clips", Icon: ScanLine },
              { step: "02", title: "Compare", detail: "Align every joint", Icon: Waypoints },
              { step: "03", title: "Improve", detail: "Train what matters", Icon: Sparkles },
            ].map(({ step, title, detail, Icon }) => (
              <div key={step} className="metric-card flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-500/20 bg-accent-500/10 text-accent-400">
                  <Icon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-semibold tracking-widest text-ink-500">{step}</span>
                    <span className="text-sm font-semibold text-ink-50">{title}</span>
                  </div>
                  <div className="truncate text-xs text-ink-400">{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="error-card" role="alert">
          Could not load all saved data: {error}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="h2">Choose your discipline</h2>
            <p className="mt-1 text-sm text-ink-400">Start with a movement-specific comparison.</p>
          </div>
          <button
            onClick={() => go({ name: "new" })}
            className="focus-ring flex items-center gap-1 rounded text-sm text-accent-400 hover:text-accent-300"
          >
            Open full picker <ArrowRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {SPORTS.slice(0, 8).map((s) => (
            <button
              key={s.id}
              onClick={() => go({ name: "new", sportId: s.id })}
              className="card group p-4 text-left hover:border-accent-500/40 hover:-translate-y-0.5 transition-all focus-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-semibold text-ink-50">{s.name}</div>
                  <div className="text-xs text-ink-400 mt-1">{s.shots.length} motions</div>
                </div>
                <ArrowUpRight
                  size={15}
                  aria-hidden="true"
                  className="mt-0.5 text-ink-500 transition-colors group-hover:text-accent-400"
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    className="w-full flex items-center justify-between gap-3 text-left rounded-lg px-3 py-2 hover:bg-white/5 transition-colors focus-ring"
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
              {analyses.length > 5 && (
                <li className="pt-1">
                  <button
                    onClick={() => go({ name: "history" })}
                    className="w-full text-center text-xs text-accent-400 hover:text-accent-300 rounded-lg py-1.5 focus-ring"
                  >
                    View all {analyses.length} analyses
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-ok" />
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
                    className="focus-ring rounded text-xs text-accent-400 hover:text-accent-300"
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
