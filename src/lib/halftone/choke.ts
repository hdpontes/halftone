import type { CoverageGrid } from "./types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Builds a downsampled binary coverage grid from a full-res alpha channel.
 * Downsampling keeps the erosion cheap for large canvases (same technique
 * already used by the edge-feather grid in the legacy engine). The grid is
 * intentionally coarse — precision for choke no longer depends on cellPx
 * being tiny, because chokeCoverageGrid uses a continuous distance transform
 * (see below) instead of counting whole-cell erosion iterations.
 */
export function buildCoverageGridFromAlpha(alpha: Uint8ClampedArray, width: number, height: number, downsample: number): CoverageGrid {
  const ds = Math.max(1, Math.round(downsample));
  const gw = Math.ceil(width / ds);
  const gh = Math.ceil(height / ds);
  const data = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(width - 1, gx * ds + (ds >> 1));
      const sy = Math.min(height - 1, gy * ds + (ds >> 1));
      data[gy * gw + gx] = alpha[sy * width + sx] > 8 ? 1 : 0;
    }
  }
  return { data, width: gw, height: gh, cellPx: ds };
}

// 1D squared Euclidean distance transform (Felzenszwalt & Huttenlocher, O(n) per line).
// f[i] = 0 at "seed" positions, +Infinity elsewhere; returns squared distance to nearest seed.
function dt1d(f: Float64Array): Float64Array {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

// Exact 2D squared Euclidean distance transform via two separable 1D passes (rows, then columns).
// Returns, for every cell, the distance (in grid-cell units) to the nearest "background" cell
// (mask value <= 0.5) — 0 for background cells themselves. The grid is implicitly padded with a
// 1-cell background border so shapes that touch/fill the canvas edge (no transparent margin)
// still erode inward from the edge, matching the old min-filter's out-of-bounds=0 behavior.
function edtToBackground(mask: Float32Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const pw = w + 2;
  const ph = h + 2;
  const f = new Float64Array(pw * ph).fill(0); // border ring stays 0 (background)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      f[(y + 1) * pw + (x + 1)] = mask[y * w + x] > 0.5 ? INF : 0;
    }
  }

  const tmp = new Float64Array(pw * ph);
  const colBuf = new Float64Array(ph);
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) colBuf[y] = f[y * pw + x];
    const d = dt1d(colBuf);
    for (let y = 0; y < ph; y++) tmp[y * pw + x] = d[y];
  }
  const out = new Float64Array(pw * ph);
  const rowBuf = new Float64Array(pw);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) rowBuf[x] = tmp[y * pw + x];
    const d = dt1d(rowBuf);
    for (let x = 0; x < pw; x++) out[y * pw + x] = d[x];
  }
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      result[y * w + x] = Math.sqrt(out[(y + 1) * pw + (x + 1)]);
    }
  }
  return result;
}

/**
 * Real geometric erosion (morphological "choke"), NOT an opacity/alpha scale.
 * Uses an exact distance transform (distance from every cell to the nearest
 * background cell) instead of a whole-grid-cell min-filter iteration count.
 * `chokePx` (source-image pixels) is compared directly against that continuous
 * distance (converted to source px via grid.cellPx) with a soft anti-aliased
 * falloff — this gives sub-cell precision (1px steps behave differently from
 * each other) even though the underlying grid is downsampled for performance,
 * unlike the previous `iterations = round(chokePx/cellPx)` approach which
 * quantized every choke value to whole multiples of cellPx (2-4px steps).
 */
export function chokeCoverageGrid(grid: CoverageGrid, chokePx: number): CoverageGrid {
  const w = grid.width;
  const h = grid.height;
  if (chokePx <= 0) return { data: grid.data.slice(), width: w, height: h, cellPx: grid.cellPx };

  const distCells = edtToBackground(grid.data, w, h);
  const chokeCells = chokePx / grid.cellPx;
  const bandCells = 0.5; // soft transition of ~1 grid cell, avoids a jagged/staircase edge
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const t = clamp((distCells[i] - (chokeCells - bandCells)) / (2 * bandCells), 0, 1);
    out[i] = grid.data[i] * t;
  }
  return { data: out, width: w, height: h, cellPx: grid.cellPx };
}

export function sampleCoverageGrid(grid: CoverageGrid, px: number, py: number): number {
  const gx = clamp(Math.floor(px / grid.cellPx), 0, grid.width - 1);
  const gy = clamp(Math.floor(py / grid.cellPx), 0, grid.height - 1);
  return grid.data[gy * grid.width + gx];
}
