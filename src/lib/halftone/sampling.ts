import type { CoverageSampler } from "./types";

/** Deterministic hash (no Math.random) used by FM/Hybrid for reproducible stochastic placement. */
export function cellHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

export interface GridCell {
  /** Grid indices (before rotation). */
  gx: number;
  gy: number;
  /** Source-image pixel coordinates of the cell center. */
  px: number;
  py: number;
}

/**
 * Iterates a rotated screen grid over a w x h image, calling `visit` for every
 * cell whose center lands inside (or just outside the border of) the image.
 * Shared by AM/FM/Hybrid so every algorithm sees the exact same cell centers.
 */
export function forEachGridCell(width: number, height: number, cellPx: number, angleDeg: number, visit: (cell: GridCell) => void): void {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = width / 2;
  const cy = height / 2;
  const diag = Math.ceil(Math.hypot(width, height));
  const cols = Math.ceil(diag / cellPx) + 4;
  const rows = Math.ceil(diag / cellPx) + 4;

  for (let gy = -rows / 2; gy < rows / 2; gy++) {
    for (let gx = -cols / 2; gx < cols / 2; gx++) {
      const rx = gx * cellPx;
      const ry = gy * cellPx;
      const px = cx + rx * cos - ry * sin;
      const py = cy + rx * sin + ry * cos;
      if (px < -cellPx || py < -cellPx || px > width + cellPx || py > height + cellPx) continue;
      visit({ gx, gy, px, py });
    }
  }
}

/** Builds a CoverageSampler that reads nearest-pixel coverage from a precomputed full-res grid. */
export function samplerFromCoverageArray(coverage: Float32Array, width: number, height: number): CoverageSampler {
  return (px: number, py: number) => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(px)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(py)));
    return coverage[iy * width + ix];
  };
}
