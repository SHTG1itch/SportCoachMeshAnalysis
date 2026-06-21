import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowRight, Play, X, Info } from "lucide-react";
import { SPORTS, findSport } from "../lib/sports";
import { MediaDrop } from "../components/MediaDrop";
import { runAnalysis, buildRecord, type AnalyzeProgress } from "../lib/analyze";
import { poseToDataUrl } from "../lib/pose/render";
import { useStore } from "../store";
import type { AnalysisReport, SportMeta } from "@shared/types";
import type { PoseFrame } from "../lib/pose/types";

/** A small skeleton render of the user's contact-moment pose, used as the
 * history / home thumbnail so saved analyses are distinguishable at a glance. */
function userKeyThumbnail(report: AnalysisReport): string | undefined {
  const m = report.mesh;
  if (!m || m.pairs.length === 0) return undefined;
  const pose = m.pairs[Math.min(m.keyIndex, m.pairs.length - 1)].user as PoseFrame;
  return (
    poseToDataUrl(pose, 96, {
      bone: "#22c38a",
      joint: "#5be0ad",
      background: "#0b0d12",
    }) ?? undefined
  );
}

export function NewAnalysis() {
  const go = useStore((s) => s.go);
  const refresh = useStore((s) => s.refresh);
  const route = useStore((s) => s.route);

  // Honor a sport pre-selected from the Home sport cards (route.sportId).
  const initialSport =
    (route.name === "new" && route.sportId && findSport(route.sportId)) || SPORTS[0];
  const [sport, setSport] = useState<SportMeta>(initialSport);
  const [shot, setShot] = useState<string>(initialSport.shots[0]);
  const [proFile, setProFile] = useState<File | null>(null);
  const [userFile, setUserFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The analysis runs detached from the React tree (it drives off-DOM <video>
  // elements), so it keeps going if the user navigates away mid-run. Track
  // liveness so a completed run that the user abandoned does not yank them off
  // whatever screen they moved to and back into the result view. The analysis is
  // still saved, so it shows up in History either way.
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canRun = !!proFile && !!userFile && !running;

  const cancel = () => {
    abortRef.current?.abort();
  };

  const start = async () => {
    if (!proFile || !userFile) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setProgress({ stage: "loading_pro", message: "Starting…", progress: 0 });
    try {
      const proKind = proFile.type.startsWith("image/") ? "image" : "video";
      const report = await runAnalysis(
        { sport, shot, proFile, userFile, proKind, signal: controller.signal },
        setProgress,
      );
      const record = buildRecord(report, userKeyThumbnail(report));
      await window.app.saveAnalysis(record);
      await refresh();
      if (!mountedRef.current) return; // user left this screen — don't force-navigate
      go({ name: "analysis", record });
    } catch (e: unknown) {
      // A user-initiated cancel is not an error — just reset the form.
      if (e instanceof DOMException && e.name === "AbortError") {
        if (mountedRef.current) setProgress(null);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        if (mountedRef.current) setError(msg);
      }
    } finally {
      abortRef.current = null;
      if (mountedRef.current) setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h1">New analysis</h1>
        <p className="mt-2 text-ink-300 max-w-xl">
          Pick the sport and shot, then upload a reference clip or photo of the pro and a
          video of yourself performing the same motion.
        </p>
      </div>

      <section className="card p-6">
        <div className="label mb-3">1. Sport</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSport(s);
                setShot(s.shots[0]);
              }}
              className={clsx(sport.id === s.id ? "chip-active" : "chip", "cursor-pointer")}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="label mb-3">2. Shot / motion</div>
        <div className="flex flex-wrap gap-2">
          {sport.shots.map((sh) => (
            <button
              key={sh}
              onClick={() => setShot(sh)}
              className={clsx(shot === sh ? "chip-active" : "chip", "cursor-pointer")}
            >
              {sh}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <div className="label mb-3">3. Upload media</div>
        <div className="flex gap-6">
          <MediaDrop
            label="Professional"
            accept="image-or-video"
            file={proFile}
            onChange={setProFile}
            hint="Image or short clip (≤ 20s)"
          />
          <MediaDrop
            label="You"
            accept="video"
            file={userFile}
            onChange={setUserFile}
            hint="Video of your technique (≤ 20s)"
          />
        </div>
        <div className="mt-4 flex items-start gap-2 text-xs text-ink-400">
          <Info size={14} className="mt-0.5 shrink-0 text-accent-400" />
          <p>
            Best results: film side-on with the <span className="text-ink-200">whole body in frame</span>,
            one clean rep, steady camera, and good lighting. Match the pro's camera angle as closely
            as you can. Clips over ~20s are sampled at a lower frame rate.
          </p>
        </div>
      </section>

      {error && (
        <div className="card p-4 border-bad/40 text-sm text-bad bg-bad/5">{error}</div>
      )}

      {progress && (
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-ink-100">{progress.message}</div>
            <div className="text-xs text-ink-400 tabular-nums">
              {(progress.progress * 100).toFixed(0)}%
            </div>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-500 transition-all"
              style={{ width: `${progress.progress * 100}%` }}
            />
          </div>
        </section>
      )}

      <div className="flex items-center justify-end gap-3">
        {running ? (
          <button onClick={cancel} className="btn-subtle text-bad hover:text-bad">
            <X size={14} /> Stop analysis
          </button>
        ) : (
          <button onClick={() => go({ name: "home" })} className="btn-subtle">
            Cancel
          </button>
        )}
        <button onClick={start} disabled={!canRun} className="btn-primary">
          {running ? (
            <>
              <Play size={14} /> Analyzing…
            </>
          ) : (
            <>
              Run analysis <ArrowRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
