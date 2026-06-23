import type { ImprovementGuide } from "@shared/types";
import { CheckCircle2, AlertCircle, Sparkles, Lightbulb } from "lucide-react";

export function GuideView({ guide }: { guide: ImprovementGuide }) {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="h3 mb-2">Overview</div>
        <p className="text-ink-100 leading-relaxed">{guide.summary}</p>
      </div>

      {guide.strengths.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={16} className="text-ok" />
            <div className="h3 m-0">What you're doing well</div>
          </div>
          <ul className="space-y-2">
            {guide.strengths.map((s) => (
              <li key={s} className="text-sm text-ink-100 flex gap-2">
                <span className="text-ok mt-1">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {guide.keyIssues.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-warn" />
            <div className="h3 m-0">Focus areas</div>
          </div>
          <div className="space-y-5">
            {guide.keyIssues.map((issue) => (
              <div key={issue.joint ?? issue.title} className="pl-4 border-l-2 border-warn/30">
                <div className="text-base font-semibold text-ink-50">{issue.title}</div>
                {issue.joint && (
                  <div className="text-xs text-ink-400 mt-0.5">
                    {issue.joint.replace(/_/g, " ")}
                  </div>
                )}
                <div className="text-sm text-ink-200 mt-2">
                  <span className="text-ink-400">Mesh difference: </span>
                  {issue.observation}
                </div>
                <div className="text-sm text-ink-200 mt-1">
                  <span className="text-ink-400">Driven by: </span>
                  {issue.cause}
                </div>
                <div className="text-sm text-accent-400 mt-1">
                  <span className="text-accent-400/70">To match the pro: </span>
                  {issue.fix}
                </div>
                {issue.muscles && issue.muscles.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-ink-400">Train:</span>
                    {issue.muscles.map((m) => (
                      <span key={m} className="chip">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {guide.drills.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-accent-400" />
              <div className="h3 m-0">Recommended drills</div>
            </div>
            <ul className="space-y-1">
              {guide.drills.map((d) => (
                <li key={d} className="text-sm text-ink-100 flex gap-2">
                  <span className="text-accent-400 mt-1">→</span>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}
        {guide.cues.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb size={16} className="text-warn" />
              <div className="h3 m-0">Mental cues</div>
            </div>
            <ul className="space-y-1">
              {guide.cues.map((c) => (
                <li key={c} className="text-sm text-ink-100 italic">
                  "{c}"
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
