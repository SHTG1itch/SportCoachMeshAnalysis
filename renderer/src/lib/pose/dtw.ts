/**
 * Dynamic Time Warping with a Sakoe-Chiba band constraint.
 *
 * Given two sequences of feature vectors, returns the optimal monotonic
 * alignment path minimizing cumulative distance, plus the normalized distance.
 *
 * The band constraint limits how far off the diagonal the warp path may go;
 * without it, DTW can produce degenerate alignments where one sequence
 * collapses to a single frame of the other. A band ratio of 0.2 means the
 * warp path may deviate by up to 20% of the longer sequence's length.
 */

export type DtwResult = {
  path: [number, number][];
  distance: number;
};

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function dtw(
  s1: number[][],
  s2: number[][],
  opts: { bandRatio?: number; distance?: (a: number[], b: number[]) => number } = {},
): DtwResult {
  const n = s1.length;
  const m = s2.length;
  if (n === 0 || m === 0) return { path: [], distance: Infinity };
  const distFn = opts.distance ?? euclidean;
  const bandRatio = opts.bandRatio ?? 0.25;
  // The band must always admit the diagonal that joins the two corners (0,0) and
  // (n,m). A cell (i,j) is only relaxed when |i - j| <= band, so the endpoint
  // (n,m) is reachable only if |n - m| <= band. With a purely ratio-derived band
  // a clip pair differing in length by more than `bandRatio` (different durations
  // OR capture fps — e.g. a 30fps vs 60fps phone clip of the same motion) leaves
  // cost[n][m] = Infinity, and the backtrack then walks the all-Infinity off-band
  // region, emitting a degenerate path that drops one clip's unmatched frames and
  // collapses the similarity score. Flooring the band at |n - m| guarantees the
  // endpoint is always feasible while preserving the off-diagonal constraint for
  // similar-length clips.
  const band = Math.max(2, Math.abs(n - m), Math.floor(Math.max(n, m) * bandRatio));

  const INF = Number.POSITIVE_INFINITY;
  // Allocate a flat Float64 cost matrix for speed.
  const cost = new Float64Array((n + 1) * (m + 1));
  cost.fill(INF);
  cost[0] = 0;

  const idx = (i: number, j: number): number => i * (m + 1) + j;

  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - band);
    const jEnd = Math.min(m, i + band);
    for (let j = jStart; j <= jEnd; j++) {
      const d = distFn(s1[i - 1], s2[j - 1]);
      const best = Math.min(
        cost[idx(i - 1, j)],
        cost[idx(i, j - 1)],
        cost[idx(i - 1, j - 1)],
      );
      cost[idx(i, j)] = d + best;
    }
  }

  // Backtrack.
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = cost[idx(i - 1, j - 1)];
    const up = cost[idx(i - 1, j)];
    const left = cost[idx(i, j - 1)];
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up < left) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();

  const raw = cost[idx(n, m)];
  const distance = raw === INF ? Infinity : raw / Math.max(n, m);
  return { path, distance };
}

/**
 * Build a per-frame similarity timeline over `refLength` frames where index i
 * is the average similarity at the DTW path step(s) touching reference frame i.
 * Similarity = 1 - min(1, dist / normalizer).
 */
export function similarityTimeline(
  s1: number[][],
  s2: number[][],
  path: [number, number][],
  refIs: "s1" | "s2",
  normalizer: number,
  distFn: (a: number[], b: number[]) => number = euclidean,
): number[] {
  const refLen = refIs === "s1" ? s1.length : s2.length;
  const sums = new Float64Array(refLen);
  const counts = new Int32Array(refLen);
  for (const [i, j] of path) {
    const idx = refIs === "s1" ? i : j;
    const d = distFn(s1[i], s2[j]);
    const sim = Math.max(0, 1 - Math.min(1, d / normalizer));
    sums[idx] += sim;
    counts[idx] += 1;
  }
  const out: number[] = [];
  for (let k = 0; k < refLen; k++) {
    out.push(counts[k] ? sums[k] / counts[k] : 0);
  }
  return out;
}
