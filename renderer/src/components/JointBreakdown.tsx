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

export function JointBreakdown({ deltas }: Props) {
  if (deltas.length === 0) {
    return <div className="text-sm text-ink-400">No joint data available.</div>;
  }
  return (
    <div className="divide-y divide-white/5">
      {deltas.map((d) => {
        const biasLabel =
          d.signedBiasDeg > 0
            ? `+${d.signedBiasDeg.toFixed(1)}° more than pro`
            : `${d.signedBiasDeg.toFixed(1)}° less than pro`;
        // Bar width: scale meanDelta against 45° max.
        const pct = Math.min(100, (d.meanDeltaDeg / 45) * 100);
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
                Δ {d.meanDeltaDeg.toFixed(1)}°
              </div>
            </div>
            <div className="mt-1 text-xs text-ink-400">{biasLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
