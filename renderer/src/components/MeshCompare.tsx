import { useState } from "react";
import type { MeshComparison } from "@shared/types";
import type { PoseFrame } from "../lib/pose/types";
import { PoseOverlay } from "./PoseOverlay";

const CANVAS_W = 300;
const CANVAS_H = 360;

/**
 * Side-by-side reconstructed skeletons (pro vs you) at time-aligned poses, with
 * a scrubber to step through the motion. This is the visual counterpart to the
 * numeric report — it shows the mesh the app is built around. Each scrubber
 * position pairs frames matched by the DTW alignment, so the two skeletons are
 * always at the SAME moment of the motion.
 */
export function MeshCompare({ mesh }: { mesh: MeshComparison }) {
  const n = mesh.pairs.length;
  // Clamp every index into range: a persisted record (parsed from the DB with no
  // schema validation) could carry an out-of-range keyIndex, and an undefined
  // pair would crash the render.
  const clamp = (i: number) => Math.min(Math.max(0, i), Math.max(0, n - 1));
  const [idx, setIdx] = useState(() => clamp(mesh.keyIndex));

  if (n === 0) {
    return (
      <div className="card p-8 text-center text-sm text-ink-400">
        No skeleton data was captured for this analysis.
      </div>
    );
  }

  const pair = mesh.pairs[idx];
  const single = n === 1;

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="h3 m-0">Skeleton comparison</div>
        <div className="text-xs text-ink-400 tabular-nums">
          {single ? "Matched pose" : `Pose ${idx + 1} / ${n}`}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 justify-items-center">
        <SkeletonPanel
          title="Pro"
          frame={pair.pro as PoseFrame}
          bone="#7ab6ff"
          joint="#9cc8ff"
        />
        <SkeletonPanel
          title="You"
          frame={pair.user as PoseFrame}
          bone="#22c38a"
          joint="#5be0ad"
        />
      </div>

      {!single && (
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={n - 1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label="Scrub through the motion"
            aria-valuetext={`Pose ${idx + 1} of ${n}${idx === clamp(mesh.keyIndex) ? " (contact)" : ""}`}
            className="w-full accent-accent-500 cursor-pointer rounded focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
          />
          <div className="flex justify-between text-[11px] text-ink-500">
            <span>Start</span>
            <button
              type="button"
              onClick={() => setIdx(clamp(mesh.keyIndex))}
              className="text-ink-400 hover:text-accent-400"
            >
              Jump to contact
            </button>
            <span>Finish</span>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-400">
        Reconstructed 3D skeletons, orthographically projected and aligned to the
        same moment of the motion. Faint or missing limbs were low-confidence
        detections and are hidden.
      </p>
    </div>
  );
}

function SkeletonPanel({
  title,
  frame,
  bone,
  joint,
}: {
  title: string;
  frame: PoseFrame;
  bone: string;
  joint: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="label mb-2">{title}</div>
      <div
        className="rounded-xl bg-canvas-900/60 border border-white/5"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        <PoseOverlay
          frame={frame}
          width={CANVAS_W}
          height={CANVAS_H}
          bone={bone}
          joint={joint}
          label={`${title} skeleton`}
        />
      </div>
    </div>
  );
}
