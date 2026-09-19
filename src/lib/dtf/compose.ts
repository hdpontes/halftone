/**
 * PASSO 6C — visual preview composition ONLY. This is a "visual approximation"
 * of White + C/M/Y/K dot layers, NOT a physical simulation of a DTF printer/RIP.
 * Canvas-free (plain typed-array rasterization) so it stays unit-testable via tsx,
 * consistent with the rest of the color/halftone core.
 */
import type { CoverageGrid, DotDescriptor } from "../halftone/types";
import type { PrintLayerSet } from "./types";

export interface ComposeOptions {
  /** Backdrop painted before any layer, RGBA 0..255. Defaults to fully transparent. */
  background?: [number, number, number, number];
}

export interface RasterBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// White still paints as a flat brand color (there's no "subtractive" White formula — it's the
// base layer, not part of the C/M/Y/K mix). cyan/magenta/yellow/black here are ONLY used by
// renderChannelPreview() (dtf/lab/lab.ts) for single-channel isolated inspection — the actual
// composePrintPreview() below now derives ink color from C/M/Y/K presence, not these constants.
export const CHANNEL_COLORS = {
  white: [255, 255, 255],
  cyan: [0, 174, 239],
  magenta: [236, 0, 140],
  yellow: [255, 241, 0],
  black: [30, 30, 30],
} as const;

/** Approximates each configured dot shape as a pixel-membership test (no canvas available here). */
export function pixelInsideDot(px: number, py: number, dot: DotDescriptor): boolean {
  if (dot.radius <= 0) return false;
  const dx = px - dot.x;
  const dy = py - dot.y;
  switch (dot.shape) {
    case "square":
      return Math.abs(dx) <= dot.radius && Math.abs(dy) <= dot.radius;
    case "diamond":
      return Math.abs(dx) + Math.abs(dy) <= dot.radius;
    case "ellipse": {
      const rx = dot.radius * 1.35,
        ry = dot.radius * 0.72;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
    case "line":
      return Math.abs(dy) <= Math.max(0.4, dot.radius * 0.4) && Math.abs(dx) <= dot.radius * 2;
    case "round":
    case "rosette": // approximated as round for preview purposes only
    default:
      return dx * dx + dy * dy <= dot.radius * dot.radius;
  }
}

/** Rasterizes a continuous CoverageGrid (White "solid" mode) directly — no dots invented. */
export function paintCoverageGrid(buffer: RasterBuffer, grid: CoverageGrid, color: readonly [number, number, number]): void {
  const { data, width, height } = buffer;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(grid.height - 1, Math.floor(y / grid.cellPx));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(grid.width - 1, Math.floor(x / grid.cellPx));
      const cov = grid.data[gy * grid.width + gx];
      if (cov <= 0) continue;
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = Math.round(Math.max(0, Math.min(1, cov)) * 255);
    }
  }
}

/** Paints a list of dots as opaque, flat-colored ink onto the buffer (source-over, last write wins per pixel). */
export function paintDots(buffer: RasterBuffer, dots: DotDescriptor[], color: readonly [number, number, number]): void {
  const { data, width, height } = buffer;
  for (const dot of dots) {
    const minX = Math.max(0, Math.floor(dot.x - dot.radius - 1));
    const maxX = Math.min(width - 1, Math.ceil(dot.x + dot.radius + 1));
    const minY = Math.max(0, Math.floor(dot.y - dot.radius - 1));
    const maxY = Math.min(height - 1, Math.ceil(dot.y + dot.radius + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!pixelInsideDot(x + 0.5, y + 0.5, dot)) continue;
        const i = (y * width + x) * 4;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 255;
      }
    }
  }
}

/**
 * Binary ink-presence mask for one CMYK channel's dots (0 or 1 per pixel) — reused instead
 * of a full RGB buffer per channel to keep memory to O(width*height) per channel, not per color
 * component. Same pixel-membership test as paintDots, just recorded as presence, not color yet.
 */
function rasterizeChannelMask(width: number, height: number, dots: DotDescriptor[]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const dot of dots) {
    const minX = Math.max(0, Math.floor(dot.x - dot.radius - 1));
    const maxX = Math.min(width - 1, Math.ceil(dot.x + dot.radius + 1));
    const minY = Math.max(0, Math.floor(dot.y - dot.radius - 1));
    const maxY = Math.min(height - 1, Math.ceil(dot.y + dot.radius + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pixelInsideDot(x + 0.5, y + 0.5, dot)) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * PASSO 6F — visual approximation only (NOT a physical RIP/ICC/ink/substrate/curing
 * simulation, no dot gain/trapping model). White is painted first as an opaque BASE layer
 * (substrato -> White -> C/M/Y/K), then each pixel's C/M/Y/K ink presence (from the actual
 * generated dots — halftone structure is preserved, not idealized coverage) is combined via
 * a simple subtractive model instead of the previous "last dot painted wins" overwrite:
 *   R = (1-C)*(1-K); G = (1-M)*(1-K); B = (1-Y)*(1-K)
 * so overlapping channels (e.g. M+Y) approximate their subtractive mix (red) rather than
 * whichever channel happened to paint last. Alpha (raw, independent art transparency) is
 * applied exactly once, at the very end, over the whole White+ink composite.
 */
export function composePrintPreview(layers: PrintLayerSet, options: ComposeOptions = {}): RasterBuffer {
  const { width, height } = layers;
  const data = new Uint8ClampedArray(width * height * 4);
  const bg = options.background ?? [0, 0, 0, 0];
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = bg[3];
  }
  const buffer: RasterBuffer = { data, width, height };

  if (layers.white.mode === "solid" && layers.white.coverage) {
    paintCoverageGrid(buffer, layers.white.coverage, CHANNEL_COLORS.white);
  } else if (layers.white.mode === "halftone" && layers.white.dots) {
    paintDots(buffer, layers.white.dots, CHANNEL_COLORS.white);
  }

  const cyanMask = rasterizeChannelMask(width, height, layers.cyan);
  const magentaMask = rasterizeChannelMask(width, height, layers.magenta);
  const yellowMask = rasterizeChannelMask(width, height, layers.yellow);
  const blackMask = rasterizeChannelMask(width, height, layers.black);

  for (let i = 0; i < width * height; i++) {
    const c = cyanMask[i],
      m = magentaMask[i],
      y = yellowMask[i],
      k = blackMask[i];
    if (c === 0 && m === 0 && y === 0 && k === 0) continue; // no ink here — White (or background) shows through untouched
    const oneMinusK = 1 - k;
    data[i * 4] = Math.round((1 - c) * oneMinusK * 255);
    data[i * 4 + 1] = Math.round((1 - m) * oneMinusK * 255);
    data[i * 4 + 2] = Math.round((1 - y) * oneMinusK * 255);
    data[i * 4 + 3] = 255; // ink dots remain opaque where present, same convention as before
  }

  for (let i = 0; i < width * height; i++) {
    const artAlpha = Math.max(0, Math.min(1, layers.alpha[i]));
    data[i * 4 + 3] = Math.round(data[i * 4 + 3] * artAlpha);
  }

  return buffer;
}
