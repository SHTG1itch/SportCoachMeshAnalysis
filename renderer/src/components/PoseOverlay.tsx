import { useEffect, useRef } from "react";
import { SKELETON_EDGES, type PoseFrame } from "../lib/pose/types";

interface Props {
  frame: PoseFrame | null;
  width: number;
  height: number;
  /** Use image-space landmarks (0..1 in screen) or world coords projected. */
  mode?: "image" | "world";
  color?: string;
  pointColor?: string;
}

/**
 * Renders a skeleton overlay. For "image" mode it expects landmarks whose
 * (x, y) are in normalized image coordinates (0..1). For "world" mode it
 * projects world-space points orthographically onto XY.
 */
export function PoseOverlay({
  frame,
  width,
  height,
  mode = "image",
  color = "#4a8ffd",
  pointColor = "#7ab6ff",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!frame) return;

    const project = (p: { x: number; y: number; z: number }) => {
      if (mode === "image") return { x: p.x * width, y: p.y * height };
      // World mode: use a simple ortho projection. We don't know the scale in
      // absolute pixels, so we auto-fit to bounding box.
      return { x: p.x, y: p.y };
    };

    let points = frame.map(project);
    if (mode === "world") {
      // Fit to canvas.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const span = Math.max(maxX - minX, maxY - minY, 1e-6);
      const scale = (Math.min(width, height) * 0.8) / span;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      points = points.map((p) => ({
        x: width / 2 + (p.x - cx) * scale,
        // Invert Y since world +y = up; canvas +y = down.
        y: height / 2 - (p.y - cy) * scale,
      }));
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [a, b] of SKELETON_EDGES) {
      const pa = points[a];
      const pb = points[b];
      const va = frame[a].visibility ?? 1;
      const vb = frame[b].visibility ?? 1;
      if (va < 0.3 || vb < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.fillStyle = pointColor;
    for (let i = 0; i < points.length; i++) {
      const vis = frame[i].visibility ?? 1;
      if (vis < 0.3) continue;
      const p = points[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frame, width, height, mode, color, pointColor]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="pointer-events-none"
    />
  );
}
