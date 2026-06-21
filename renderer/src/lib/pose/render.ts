// Skeleton rendering helpers shared by the on-screen mesh overlay and the
// history thumbnail. Kept separate from React so the geometry is pure and
// unit-testable, and so a frame can be rasterized to a data URL off-DOM.

import { L, SKELETON_EDGES, type PoseFrame } from "./types";

export interface Point2D {
  x: number;
  y: number;
}

export interface SkeletonColors {
  bone: string;
  joint: string;
  background?: string;
}

/** Landmarks below this visibility are treated as unreliable and not drawn (and
 * are excluded from the auto-fit bounding box so a hallucinated limb flung off to
 * the side can't shrink the rest of the skeleton to a dot). */
const DRAW_VIS = 0.3;

/**
 * Orthographically project a (hip-centered, torso-normalized) world-coordinate
 * pose frame into canvas pixel space.
 *
 * Two things this gets right that a naive `x*width, y*height` does not:
 *  - It auto-fits the visible landmarks' bounding box into the canvas with a
 *    margin, so the skeleton always fills the frame regardless of metric scale.
 *  - It auto-orients head-up from the DATA (nose vs hip midpoint) rather than
 *    assuming a y-up convention. MediaPipe world landmarks are y-DOWN (the head
 *    sits at a smaller/negative y than the hips), so a fixed y-flip would render
 *    every real skeleton upside-down. Deriving the sign per-frame is robust to
 *    either convention.
 */
export function projectPose(
  frame: PoseFrame,
  width: number,
  height: number,
  pad = 0.82,
): Point2D[] {
  // Bounding box over the landmarks we'd actually draw.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const p of frame) {
    if ((p.visibility ?? 1) < DRAW_VIS) continue;
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!any) {
    // Nothing reliable — fall back to the full set so we still produce sensible
    // numbers rather than Infinity.
    for (const p of frame) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = (Math.min(width, height) * pad) / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Head-up sign, derived from the always-present core landmarks (shoulders sit
  // toward the head, hips toward the feet) rather than the nose, which can be at
  // the origin when low-visibility. Pick the sign that projects the shoulder
  // midpoint ABOVE the hip midpoint on the canvas. This is robust to either the
  // y-down convention of MediaPipe world coords (head at smaller y) or a y-up
  // convention, so the skeleton is never rendered upside-down.
  const shMidY = (frame[L.LEFT_SHOULDER].y + frame[L.RIGHT_SHOULDER].y) / 2;
  const hipMidY = (frame[L.LEFT_HIP].y + frame[L.RIGHT_HIP].y) / 2;
  const sign = shMidY < hipMidY ? 1 : -1;

  return frame.map((p) => ({
    x: width / 2 + (p.x - cx) * scale,
    y: height / 2 + sign * (p.y - cy) * scale,
  }));
}

/** Draw a skeleton onto a 2D canvas context. Clears nothing — the caller owns
 * the canvas. Edges/joints whose endpoint visibility is below the gate are
 * skipped so occluded or interpolated limbs aren't drawn as confident lines. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  width: number,
  height: number,
  colors: SkeletonColors,
): void {
  if (colors.background) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
  }
  const pts = projectPose(frame, width, height);

  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 80));
  ctx.strokeStyle = colors.bone;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of SKELETON_EDGES) {
    if ((frame[a].visibility ?? 1) < DRAW_VIS || (frame[b].visibility ?? 1) < DRAW_VIS) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.stroke();
  }

  const r = Math.max(2, Math.round(Math.min(width, height) / 70));
  ctx.fillStyle = colors.joint;
  for (let i = 0; i < pts.length; i++) {
    if ((frame[i].visibility ?? 1) < DRAW_VIS) continue;
    // Only dot the major joints (the ones the skeleton edges connect) so the
    // face/hand clutter stays out.
    if (!MAJOR_JOINTS.has(i)) continue;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The joints the skeleton edges connect — used to keep the dotted points to the
 * meaningful articulation points rather than every one of the 33 landmarks. */
const MAJOR_JOINTS: Set<number> = new Set(
  SKELETON_EDGES.flatMap(([a, b]) => [a, b]),
);

/**
 * Rasterize a single pose to a PNG data URL (for the history/home thumbnail).
 * Renderer-only (uses an off-DOM canvas). Returns null if a 2D context can't be
 * obtained.
 */
export function poseToDataUrl(
  frame: PoseFrame,
  size: number,
  colors: SkeletonColors,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawSkeleton(ctx, frame, size, size, colors);
  return canvas.toDataURL("image/png");
}
