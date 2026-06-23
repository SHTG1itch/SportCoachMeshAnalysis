import { useState } from "react";
import type { Workout } from "@shared/types";
import { Bookmark, BookmarkCheck, ChevronDown, Clock, Target } from "lucide-react";
import clsx from "clsx";

interface Props {
  workout: Workout;
  saved: boolean;
  /** Toggle/save action. Omit to render the saved state as a passive indicator
   * (e.g. in the library, where removal is a separate explicit control) so the
   * "Saved" button doesn't double as a destructive action. */
  onSave?: () => void;
}

const DIFFICULTY_STYLE: Record<Workout["difficulty"], string> = {
  beginner: "text-ok border-ok/30 bg-ok/10",
  intermediate: "text-warn border-warn/40 bg-warn/10",
  advanced: "text-bad border-bad/40 bg-bad/10",
};

export function WorkoutCard({ workout, saved, onSave }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx("chip border", DIFFICULTY_STYLE[workout.difficulty])}>
              {workout.difficulty}
            </span>
            <span className="chip">
              <Clock size={11} /> {workout.durationMin} min
            </span>
          </div>
          <h3 className="text-lg font-semibold text-ink-50">{workout.title}</h3>
          <p className="text-sm text-ink-300 mt-1">{workout.focus}</p>
        </div>
        {onSave ? (
          <button
            onClick={onSave}
            className={clsx(
              "btn",
              saved
                ? "bg-accent-500/10 text-accent-400 border border-accent-500/30"
                : "text-ink-300 hover:text-ink-50 hover:bg-white/5 border border-white/5",
            )}
            title={saved ? "Saved" : "Save workout"}
          >
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            {saved ? "Saved" : "Save"}
          </button>
        ) : (
          // Passive status indicator (not a button) — no action wired, so it
          // can't be mistaken for a control.
          <span
            className="btn bg-accent-500/10 text-accent-400 border border-accent-500/30 cursor-default"
            title="Saved to your library"
          >
            <BookmarkCheck size={14} /> Saved
          </span>
        )}
      </div>

      {workout.targetsMuscles && workout.targetsMuscles.length > 0 ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Target size={12} className="text-ink-400" />
          <span className="text-xs text-ink-400">Muscles:</span>
          {workout.targetsMuscles.map((m) => (
            <span key={m} className="chip">
              {m.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ) : (
        workout.targetsJoints.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Target size={12} className="text-ink-400" />
            {workout.targetsJoints.map((j) => (
              <span key={j} className="chip">
                {j.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-4 text-sm text-ink-300 hover:text-ink-50 flex items-center gap-1"
      >
        <ChevronDown
          size={14}
          className={clsx("transition-transform", open && "rotate-180")}
        />
        {open ? "Hide" : "Show"} full workout
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <Section title="Warm-up" steps={workout.warmup} />
          <Section title="Main set" steps={workout.main} />
          <Section title="Cool-down" steps={workout.cooldown} />
          {workout.notes && (
            <div className="text-xs text-ink-400 border-l-2 border-accent-500/40 pl-3">
              {workout.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, steps }: { title: string; steps: Workout["main"] }) {
  if (steps.length === 0) return null;
  return (
    <div>
      <div className="h3 mb-2">{title}</div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-xs text-ink-400 tabular-nums w-6 shrink-0 pt-0.5">
              {i + 1}.
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-50">
                {s.name}
                <span className="text-ink-400 font-normal ml-2">
                  {s.sets && s.reps
                    ? `${s.sets} × ${s.reps}`
                    : s.durationSec
                      ? `${s.durationSec}s`
                      : ""}
                </span>
              </div>
              <div className="text-sm text-ink-300 mt-0.5">{s.description}</div>
              {s.cues && s.cues.length > 0 && (
                <div className="mt-1 text-xs text-ink-400 italic">
                  Cues: {s.cues.join(" · ")}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
