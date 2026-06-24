import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import type { AnalysisRecord, SavedWorkout, Workout } from "@shared/types";
import { generateGuideAndWorkouts } from "../lib/coach";
import { DeltaChart } from "../components/DeltaChart";
import { JointBreakdown } from "../components/JointBreakdown";
import { GuideView } from "../components/GuideView";
import { WorkoutCard } from "../components/WorkoutCard";
import { MeshCompare } from "../components/MeshCompare";
import { useStore } from "../store";

type TabId = "summary" | "skeleton" | "joints" | "guide" | "workouts";

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "skeleton", label: "Skeleton" },
  { id: "joints", label: "Joint breakdown" },
  { id: "guide", label: "Coaching guide" },
  { id: "workouts", label: "Workouts" },
];

export function AnalysisResult({
  record,
  backTo = "home",
}: {
  record: AnalysisRecord;
  backTo?: "home" | "history";
}) {
  const go = useStore((s) => s.go);
  const refresh = useStore((s) => s.refresh);
  const savedWorkouts = useStore((s) => s.workouts);

  const [current, setCurrent] = useState<AnalysisRecord>(record);
  const [tab, setTab] = useState<TabId>("summary");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [workoutError, setWorkoutError] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const { report } = current;

  useEffect(() => setCurrent(record), [record]);

  const savedIds = useMemo(
    () => new Set(savedWorkouts.map((s) => s.workout.id)),
    [savedWorkouts],
  );

  const regen = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = generateGuideAndWorkouts({
        sport: report.sport,
        shot: report.shot,
        numericReport: {
          overallSimilarity: report.overallSimilarity,
          jointDeltas: report.jointDeltas,
          phases: report.phases,
          mode: report.mode,
          handedness: report.handedness,
        },
      });
      const updated: AnalysisRecord = {
        ...current,
        report: { ...report, guide: res.guide, workouts: res.workouts },
      };
      await window.app.saveAnalysis(updated);
      setCurrent(updated);
    } catch (e: unknown) {
      setRegenError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const onSaveWorkout = async (w: Workout) => {
    setWorkoutError(null);
    const saved: SavedWorkout = {
      id: w.id,
      savedAt: new Date().toISOString(),
      analysisId: current.id,
      workout: w,
      tags: [report.sport.name, report.shot],
    };
    try {
      await window.app.saveWorkout(saved);
      await refresh();
    } catch (e) {
      // Surface the failure instead of leaving an unhandled promise rejection.
      setWorkoutError(
        e instanceof Error ? `Couldn't save workout: ${e.message}` : "Couldn't save workout.",
      );
    }
  };

  const onDelete = async () => {
    try {
      await window.app.deleteAnalysis(current.id);
      await refresh();
      go({ name: "history" });
    } catch (e) {
      console.error("Failed to delete analysis:", e);
      setConfirmDelete(false);
    }
  };

  const sim = report.overallSimilarity;
  const simColor =
    sim >= 0.75
      ? "text-ok"
      : sim >= 0.55
        ? "text-warn"
        : "text-bad";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => go({ name: backTo })}
          className="btn-subtle"
        >
          <ArrowLeft size={14} /> Back to {backTo === "history" ? "history" : "home"}
        </button>
        <div className="flex items-center gap-2">
          <button onClick={regen} className="btn-ghost" disabled={regenerating}>
            <RefreshCw size={14} className={regenerating ? "animate-spin" : undefined} />
            {regenerating ? "Regenerating…" : "Regenerate guide"}
          </button>
          {confirmDelete ? (
            <>
              <button onClick={onDelete} className="btn-subtle text-bad hover:text-bad">
                <Trash2 size={14} /> Confirm delete
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-subtle">
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="btn-subtle text-bad hover:text-bad"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="card p-6 flex items-center gap-6">
        <div>
          <div className="label">Overall technique similarity</div>
          <div className={clsx("text-5xl font-semibold tabular-nums mt-1", simColor)}>
            {(sim * 100).toFixed(0)}
            <span className="text-2xl text-ink-400">%</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm text-ink-50 font-medium">
            {report.sport.name} · {report.shot}
          </div>
          <div className="text-xs text-ink-400 mt-1">
            {report.mode === "sequence"
              ? `${report.proFrameCount} pro frames aligned to ${report.userFrameCount} user frames via DTW`
              : `Single-frame comparison — matched to your frame #${report.keyUserFrame}`}
          </div>
          {report.alignment && (
            <div className="mt-3">
              <DeltaChart timeline={report.alignment.similarityTimeline} />
            </div>
          )}
          {report.handedness?.mirrored && (
            <div className="text-xs text-ink-300 mt-2">
              Mirrored comparison: your {report.handedness.user}-dominant motion was
              flipped to match the {report.handedness.pro}-handed reference, so
              left/right labels follow the pro's body.
            </div>
          )}
          {report.coverage &&
            (report.coverage.pro < 0.8 || report.coverage.user < 0.8) && (
              <div className="text-xs text-warn mt-2">
                Low pose detection ({Math.round(report.coverage.pro * 100)}% pro,{" "}
                {Math.round(report.coverage.user * 100)}% you). Gaps were
                interpolated — results are less reliable. Try clearer, full-body
                footage.
              </div>
            )}
        </div>
      </div>

      <div
        className="flex items-center gap-2 border-b border-white/5"
        role="tablist"
        aria-label="Analysis sections"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={clsx(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px rounded-t",
              "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
              tab === t.id
                ? "border-accent-500 text-ink-50"
                : "border-transparent text-ink-400 hover:text-ink-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
      >
      {tab === "summary" && (
        <div className="grid grid-cols-2 gap-6">
          <div className="card p-5">
            <div className="h3 mb-3">Phases detected</div>
            {report.phases.length === 0 ? (
              <div className="text-sm text-ink-400">
                {report.mode === "single_frame"
                  ? "Single-frame mode — no phase segmentation."
                  : "Phases could not be determined from this clip."}
              </div>
            ) : (
              <ul className="space-y-3">
                {report.phases.map((p) => (
                  <li key={p.name}>
                    <div className="text-sm font-semibold text-ink-50 capitalize">
                      {p.name.replace("_", " ")}
                    </div>
                    <div className="text-xs text-ink-400">
                      Frames {p.startFrame}–{p.endFrame}
                    </div>
                    {p.note && (
                      <div className="text-xs text-ink-300 mt-0.5">{p.note}</div>
                    )}
                    {p.topDeltas[0] && (
                      <div className="text-xs text-ink-300 mt-1">
                        Biggest delta:{" "}
                        <span className="text-ink-100">{p.topDeltas[0].label}</span> · Δ{" "}
                        {Math.abs(p.topDeltas[0].signedBiasDeg).toFixed(1)}°
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card p-5">
            <div className="h3 mb-3">Top differences</div>
            <JointBreakdown deltas={report.jointDeltas.slice(0, 5)} />
          </div>
        </div>
      )}

      {tab === "skeleton" && (
        <>
          {report.mesh && report.mesh.pairs.length > 0 ? (
            <MeshCompare mesh={report.mesh} />
          ) : (
            <div className="card p-8 text-center text-sm text-ink-400">
              No skeleton was captured for this analysis. Re-run the analysis to
              see the reconstructed pose comparison.
            </div>
          )}
        </>
      )}

      {tab === "joints" && (
        <div className="card p-5">
          <JointBreakdown deltas={report.jointDeltas} />
        </div>
      )}

      {tab === "guide" && (
        <>
          {report.guide ? (
            <GuideView guide={report.guide} />
          ) : (
            <div className="card p-8 text-center">
              <Sparkles className="mx-auto text-accent-400 mb-3" />
              <div className="text-sm text-ink-100 mb-3">
                No coaching guide yet — generate one from your comparison. It's computed
                on-device, free, and takes a moment.
              </div>
              {regenError && (
                <div className="text-xs text-bad mb-3">{regenError}</div>
              )}
              <button className="btn-primary" onClick={regen} disabled={regenerating}>
                <RefreshCw size={14} className={regenerating ? "animate-spin" : undefined} />
                {regenerating ? "Generating…" : "Generate guide"}
              </button>
            </div>
          )}
        </>
      )}

      {tab === "workouts" && (
        <>
          {report.workouts.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-sm text-ink-100 mb-3">
                No workouts generated yet — run the guide step to create them.
              </div>
              <button className="btn-primary" onClick={regen} disabled={regenerating}>
                <Save size={14} /> Generate workouts
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {workoutError && (
                <div className="text-xs text-bad" role="alert">
                  {workoutError}
                </div>
              )}
              {report.workouts.map((w) => (
                <WorkoutCard
                  key={w.id}
                  workout={w}
                  saved={savedIds.has(w.id)}
                  onSave={() => onSaveWorkout(w)}
                />
              ))}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

