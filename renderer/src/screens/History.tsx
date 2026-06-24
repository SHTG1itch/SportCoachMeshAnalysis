import { useState } from "react";
import { useStore } from "../store";
import { Clock, Plus, Trash2, X } from "lucide-react";

export function History() {
  const analyses = useStore((s) => s.analyses);
  const go = useStore((s) => s.go);
  const refresh = useStore((s) => s.refresh);
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);

  // Two-stage delete: the first click arms the row, the second confirms. Avoids
  // a single mis-click permanently destroying an analysis that took minutes to
  // compute and needs the original clips to reproduce.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const del = async (id: string) => {
    try {
      await window.app.deleteAnalysis(id);
      await refresh();
    } catch (e) {
      console.error("Failed to delete analysis:", e);
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Analysis history</h1>
        <p className="mt-2 text-ink-300">All runs stay on this device.</p>
      </div>

      {error && (
        <div className="error-card" role="alert">{error}</div>
      )}

      {!loaded ? (
        <div className="card p-8 text-center text-sm text-ink-400">Loading…</div>
      ) : analyses.length === 0 ? (
        <div className="card p-10 flex flex-col items-center gap-3 text-center">
          <div className="h-11 w-11 rounded-full bg-white/5 flex items-center justify-center text-ink-400">
            <Clock size={20} />
          </div>
          <div className="text-sm text-ink-400 max-w-sm">
            No analyses yet. Compare your technique to a pro's and your runs will
            show up here.
          </div>
          <button onClick={() => go({ name: "new" })} className="btn-primary mt-1">
            <Plus size={14} /> New analysis
          </button>
        </div>
      ) : (
        <div className="card divide-y divide-white/5">
          {analyses.map((a) => {
            const sim = Math.round(a.report.overallSimilarity * 100);
            const confirming = confirmId === a.id;
            return (
              <div key={a.id} className="p-4 flex items-center gap-4">
                {a.thumbnailDataUrl && (
                  <img
                    src={a.thumbnailDataUrl}
                    alt=""
                    className="h-12 w-12 rounded-md bg-canvas-900 object-contain shrink-0 border border-white/5"
                  />
                )}
                <button
                  onClick={() => go({ name: "analysis", record: a, from: "history" })}
                  className="flex-1 min-w-0 text-left rounded-lg focus-ring"
                >
                  <div className="text-sm font-medium text-ink-50 truncate">
                    {a.report.sport.name} · {a.shot}
                  </div>
                  <div className="text-xs text-ink-400 mt-0.5">
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </button>
                <div className="text-sm tabular-nums text-ink-200 shrink-0">{sim}%</div>
                {confirming ? (
                  <div className="flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-1 shrink-0">
                    <span className="text-xs text-bad">Delete?</span>
                    <button
                      onClick={() => del(a.id)}
                      className="text-xs font-medium text-bad hover:underline rounded focus-ring"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-ink-400 hover:text-ink-100 rounded focus-ring"
                      aria-label="Cancel delete"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(a.id)}
                    className="text-ink-400 hover:text-bad rounded p-1 shrink-0 focus-ring"
                    aria-label={`Delete ${a.report.sport.name} ${a.shot} analysis`}
                    title="Delete analysis"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
