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
 * A shared projection viewport: the world-space box to fit into the canvas and
 * the head-up y sign. Computed ONCE over a whole clip (or a pro+user pair set)
 * so that (a) scrubbing through a motion doesn't make the skeleton pulse or
 * snap in size as its per-frame bounding box changes, and (b) the pro and user
 * skeletons share a scale — a compact crouch and a full extension must NOT be
 * auto-equalized to fill the canvas identically when the whole point is
 * comparing them.
 */
export interface PoseFit {
  cx: number;
  cy: number;
  span: number;
  /** +1 when smaller y should render toward the top of the canvas, else -1. */
  sign: number;
}

/** Accumulate the visible-landmark bounding box of one frame into a box. */
function growBox(
  frame: PoseFrame,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  gate: boolean,
): boolean {
  let any = false;
  for (const p of frame) {
    if (gate && (p.visibility ?? 1) < DRAW_VIS) continue;
    any = true;
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return any;
}

/**
 * Compute one shared viewport over every frame given (typically all pro AND
 * user poses of a comparison). The head-up sign is a majority vote across
 * frames with confidently-visible torso landmarks, so a single inverted or
 * degenerate frame (mid-dive, occluded torso) can't flip the whole clip's
 * orientation — deriving it per frame made consecutive scrubber poses render
 * vertically mirrored the instant shoulders crossed hip height.
 */
export function computeFit(frames: PoseFrame[]): PoseFit {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let any = false;
  for (const f of frames) any = growBox(f, box, true) || any;
  if (!any) {
    // Nothing reliable anywhere — fall back to the full landmark set so we
    // still produce sensible numbers rather than Infinity.
    for (const f of frames) growBox(f, box, false);
  }
  let up = 0;
  let down = 0;
  for (const f of frames) {
    const ls = f[L.LEFT_SHOULDER];
    const rs = f[L.RIGHT_SHOULDER];
    const lh = f[L.LEFT_HIP];
    const rh = f[L.RIGHT_HIP];
    if (!ls || !rs || !lh || !rh) continue;
    const gated =
      (ls.visibility ?? 1) < DRAW_VIS ||
      (rs.visibility ?? 1) < DRAW_VIS ||
      (lh.visibility ?? 1) < DRAW_VIS ||
      (rh.visibility ?? 1) < DRAW_VIS;
    if (gated) continue;
    const shMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    if (shMidY < hipMidY) up++;
    else if (shMidY > hipMidY) down++;
  }
  if (up === 0 && down === 0) {
    // No confident torso anywhere — vote without the visibility gate.
    for (const f of frames) {
      const shMidY = ((f[L.LEFT_SHOULDER]?.y ?? 0) + (f[L.RIGHT_SHOULDER]?.y ?? 0)) / 2;
      const hipMidY = ((f[L.LEFT_HIP]?.y ?? 0) + (f[L.RIGHT_HIP]?.y ?? 0)) / 2;
      if (shMidY < hipMidY) up++;
      else if (shMidY > hipMidY) down++;
    }
  }
  return {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    span: Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6),
    sign: up >= down ? 1 : -1,
  };
}

/**
 * Orthographically project a (hip-centered, torso-normalized) world-coordinate
 * pose frame into canvas pixel space.
 *
 * Two things this gets right that a naive `x*width, y*height` does not:
 *  - It fits a world-space box into the canvas with a margin, so the skeleton
 *    always fills the frame regardless of metric scale.
 *  - It orients head-up from the DATA (shoulders vs hips) rather than assuming
 *    a y-up convention. MediaPipe world landmarks are y-DOWN (the head sits at
 *    a smaller/negative y than the hips), so a fixed y-flip would render every
 *    real skeleton upside-down.
 *
 * `fit` supplies a shared viewport (see computeFit). Omitted, the frame is
 * auto-fitted on its own — correct for a lone thumbnail, wrong for animation
 * or side-by-side comparison.
 */
export function projectPose(
  frame: PoseFrame,
  width: number,
  height: number,
  pad = 0.82,
  fit?: PoseFit,
): Point2D[] {
  const { cx, cy, span, sign } = fit ?? computeFit([frame]);
  const scale = (Math.min(width, height) * pad) / span;
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
  fit?: PoseFit,
): void {
  if (colors.background) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
  }
  const pts = projectPose(frame, width, height, undefined, fit);

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
