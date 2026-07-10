import clsx from "clsx";
import type { JointDelta } from "@shared/types";

interface Props {
  deltas: JointDelta[];
}

const SIG_STYLE: Record<JointDelta["significance"], string> = {
  high: "text-bad border-bad/40 bg-bad/10",
  medium: "text-warn border-warn/40 bg-warn/10",
  low: "text-ok border-ok/30 bg-ok/10",
};

/** Mirrors COACHABLE_CONF in coach.ts / VIS_THRESHOLD in the pose pipeline:
 * below this average detection confidence the joint's numbers are detector
 * guesses, and the coach deliberately refuses to coach it. */
const SEEN_CONF = 0.3;

/** A joint the cameras couldn't see: its significance was forced to "low" by
 * the confidence gate, but its angles/deltas are raw guesses that can be
 * large — rendering them like measurements (green chip, near-full bar) made
 * occluded joints look like the best AND worst matched rows at once. */
export function jointNotSeen(d: JointDelta): boolean {
  return (d.avgConf ?? 1) < SEEN_CONF;
}

export function JointBreakdown({ deltas }: Props) {
  if (deltas.length === 0) {
    return <div className="text-sm text-ink-400">No joint data available.</div>;
  }
  return (
    <div className="divide-y divide-white/5">
      {deltas.map((d) => {
        if (jointNotSeen(d)) {
          return (
            <div key={d.joint} className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="chip border text-ink-400 border-white/10 bg-white/5">
                    not seen
                  </span>
                  <span className="text-sm font-medium text-ink-300">{d.label}</span>
                </div>
              </div>
              <div className="mt-1 text-xs text-ink-400">
                The camera couldn't see this joint clearly enough to measure it.
              </div>
            </div>
          );
        }
        const biasLabel =
          Math.round(Math.abs(d.signedBiasDeg) * 10) === 0
            ? "matches the pro's average"
            : d.signedBiasDeg > 0
              ? `+${d.signedBiasDeg.toFixed(1)}° more than pro`
              : `${d.signedBiasDeg.toFixed(1)}° less than pro`;
        // Bar width scales the systematic gap (|signed bias|) against 30° max —
        // this is the coachable difference that also drives significance.
        const gap = Math.abs(d.signedBiasDeg);
        const pct = Math.min(100, (gap / 30) * 100);
        return (
          <div key={d.joint} className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={clsx("chip border", SIG_STYLE[d.significance])}>
                  {d.significance}
                </span>
                <span className="text-sm font-medium text-ink-50">{d.label}</span>
              </div>
              <div className="text-xs text-ink-400 tabular-nums">
                pro {d.proMeanDeg.toFixed(0)}° · you {d.userMeanDeg.toFixed(0)}°
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    "h-full rounded-full",
                    d.significance === "high"
                      ? "bg-bad"
                      : d.significance === "medium"
                        ? "bg-warn"
                        : "bg-ok",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs tabular-nums text-ink-200 w-28 text-right">
                Δ {gap.toFixed(1)}°
              </div>
            </div>
            <div className="mt-1 text-xs text-ink-400">{biasLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
