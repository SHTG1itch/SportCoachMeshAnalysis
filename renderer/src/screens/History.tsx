import { useStore } from "../store";
import { Trash2 } from "lucide-react";

export function History() {
  const analyses = useStore((s) => s.analyses);
  const go = useStore((s) => s.go);
  const refresh = useStore((s) => s.refresh);

  const del = async (id: string) => {
    await window.app.deleteAnalysis(id);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Analysis history</h1>
        <p className="mt-2 text-ink-300">All runs stay on this device.</p>
      </div>

      {analyses.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-400">
          No analyses yet.
        </div>
      ) : (
        <div className="card divide-y divide-white/5">
          {analyses.map((a) => {
            const sim = Math.round(a.report.overallSimilarity * 100);
            return (
              <div key={a.id} className="p-4 flex items-center gap-4">
                <button
                  onClick={() => go({ name: "analysis", record: a })}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium text-ink-50">
                    {a.report.sport.name} · {a.shot}
                  </div>
                  <div className="text-xs text-ink-400 mt-0.5">
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </button>
                <div className="text-sm tabular-nums text-ink-200">{sim}%</div>
                <button
                  onClick={() => del(a.id)}
                  className="text-ink-400 hover:text-bad"
                  title="Delete analysis"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
