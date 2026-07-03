import { useEffect, useRef } from "react";
import type { PoseFrame } from "../lib/pose/types";
import { drawSkeleton, type PoseFit } from "../lib/pose/render";

interface Props {
  frame: PoseFrame | null;
  width: number;
  height: number;
  bone?: string;
  joint?: string;
  /** Accessible description of who/what this skeleton shows. */
  label?: string;
  className?: string;
  /** Shared viewport (scale/center/orientation) so animated or side-by-side
   * skeletons hold a stable, comparable size. Omitted = auto-fit this frame. */
  fit?: PoseFit;
}

/**
 * Renders a single reconstructed skeleton onto a canvas. The projection
 * (auto-fit + head-up orientation derived from the data) lives in
 * lib/pose/render so it stays pure and testable and so the same drawing backs
 * the history thumbnail.
 */
export function PoseOverlay({
  frame,
  width,
  height,
  bone = "#4a8ffd",
  joint = "#7ab6ff",
  label,
  className,
  fit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!frame) return;
    drawSkeleton(ctx, frame, width, height, { bone, joint }, fit);
  }, [frame, width, height, bone, joint, fit]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? "Pose skeleton"}
      className={className}
    />
  );
}
