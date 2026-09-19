import { MAX_RADIUS_FACTOR, SS_BUCKET_STEPS, SS_FACTOR } from "./constants";
import type { DotDescriptor, DotShape } from "./types";

// Browser-only canvas rendering helpers (shape drawing + supersampled AA tile cache).
// Kept separate from am/fm/hybrid/white/choke so the numeric core stays DOM-free and testable.

export function drawShape(ctx: CanvasRenderingContext2D, shape: DotShape, px: number, py: number, radius: number, cellSize: number, rotAngle: number): void {
  if (radius <= 0) return;
  if (shape === "round") {
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rotAngle);
  if (shape === "square" || shape === "diamond") {
    const side = radius * 1.772;
    if (shape === "diamond") ctx.rotate(Math.PI / 4);
    ctx.fillRect(-side / 2, -side / 2, side, side);
  } else if (shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.35, radius * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === "line") {
    // `radius` already encodes sqrt(coverage) (area-based, shared with round/square/ellipse);
    // a line's *width* must track coverage linearly, so undo the sqrt before sizing the bar.
    const maxRadius = cellSize * MAX_RADIUS_FACTOR;
    const coverage = Math.min(1, (radius / maxRadius) ** 2);
    const barHeight = Math.max(0.4, coverage * cellSize);
    ctx.fillRect(-cellSize / 2, -barHeight / 2, cellSize, barHeight);
  } else if (shape === "rosette") {
    const sub = Math.max(0.3, radius * 0.5);
    const spread = Math.min(cellSize * 0.28, radius * 0.9 + 0.6);
    for (const deg of [0, 45, 90, 135]) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(Math.cos(rad) * spread, Math.sin(rad) * spread, sub, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export interface DotTileCache {
  tileNative: number;
  getTile(shape: DotShape, radius: number): HTMLCanvasElement;
}

/**
 * Pre-renders a small set of 4x supersampled, downscaled dot tiles keyed by
 * shape + quantized radius bucket, and reuses them for every dot. Rendering a
 * fresh supersample per dot is far too slow for large/fine halftones; this
 * cache keeps the expensive downscale to a few dozen renders total.
 */
export function createDotTileCache(cellPx: number, maxRadius: number, angle: number): DotTileCache {
  const tileNative = Math.max(8, Math.ceil((cellPx * 1.3 + 2) * 2));
  const ssCanvas = document.createElement("canvas");
  ssCanvas.width = tileNative * SS_FACTOR;
  ssCanvas.height = tileNative * SS_FACTOR;
  const ssCtx = ssCanvas.getContext("2d")!;
  const cache = new Map<string, HTMLCanvasElement>();

  function getTile(shape: DotShape, radius: number): HTMLCanvasElement {
    const q = Math.max(1, Math.round((radius / maxRadius) * SS_BUCKET_STEPS));
    const key = shape + "_" + q;
    let tile = cache.get(key);
    if (!tile) {
      const rq = (q / SS_BUCKET_STEPS) * maxRadius;
      ssCtx.setTransform(1, 0, 0, 1, 0, 0);
      ssCtx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
      ssCtx.setTransform(SS_FACTOR, 0, 0, SS_FACTOR, ssCanvas.width / 2, ssCanvas.height / 2);
      drawShape(ssCtx, shape, 0, 0, rq, cellPx, angle);
      tile = document.createElement("canvas");
      tile.width = tileNative;
      tile.height = tileNative;
      const tileCtx = tile.getContext("2d")!;
      tileCtx.imageSmoothingEnabled = true;
      tileCtx.imageSmoothingQuality = "high";
      tileCtx.drawImage(ssCanvas, 0, 0, tileNative, tileNative);
      cache.set(key, tile);
    }
    return tile;
  }

  return { tileNative, getTile };
}

/** Draws every dot from a DotDescriptor list onto `ctx` using the shared supersample tile cache. */
export function renderDots(ctx: CanvasRenderingContext2D, dots: DotDescriptor[], cache: DotTileCache): void {
  for (const dot of dots) {
    const tile = cache.getTile(dot.shape, dot.radius);
    ctx.drawImage(tile, dot.x - cache.tileNative / 2, dot.y - cache.tileNative / 2);
  }
}
