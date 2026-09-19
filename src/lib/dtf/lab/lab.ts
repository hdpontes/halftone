/**
 * PASSO 6E — Test Lab core: runs the same synthetic input through the legacy
 * "pro-rgb" engine (halftone/engine.ts, single ink channel + White) and the new
 * "pro-cmyk(+White)" engine (dtf/engine.ts, independent C/M/Y/K + White), and
 * exposes isolated per-channel previews + numeric metrics for comparison.
 *
 * Diagnostic-only module: never modifies am.ts/fm.ts/hybrid.ts/separation.ts/
 * screening.ts/white.ts/choke.ts, never touches HalftoneStudio.tsx, and is not
 * wired into any UI or the official exporter.
 */
import { runHalftoneEngine } from "../../halftone/engine";
import { DEFAULT_HALFTONE_SETTINGS } from "../../halftone/constants";
import type { HalftoneLayers, HalftoneSettings } from "../../halftone/types";
import { separateRgbToCmyk } from "../../color/separation";
import type { ColorChannels } from "../../color/separation";
import { buildPrintLayerSet, DEFAULT_PRINT_ENGINE_SETTINGS } from "../engine";
import { composePrintPreview, paintDots, paintCoverageGrid, CHANNEL_COLORS } from "../compose";
import type { RasterBuffer } from "../compose";
import type { PrintEngineSettings, PrintLayerSet } from "../types";
import type { LabImage } from "./generators";

export type ChannelName = "cyan" | "magenta" | "yellow" | "black" | "white" | "alpha";

export interface CoverageStats {
  avg: number;
  min: number;
  max: number;
}

export interface LegacyRunResult {
  layers: HalftoneLayers;
  preview: RasterBuffer;
  timeMs: number;
}

export interface CmykRunResult {
  layers: PrintLayerSet;
  separationChannels: ColorChannels;
  preview: RasterBuffer;
  timeMs: number;
}

export interface LabMetrics {
  legacyTimeMs: number;
  cmykTimeMs: number;
  heapUsedMB: number;
  dots: { cyan: number; magenta: number; yellow: number; black: number; white: number; legacyColor: number; legacyWhite: number };
  coverage: { cyan: CoverageStats; magenta: CoverageStats; yellow: CoverageStats; black: CoverageStats };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Runs the existing single-channel ("pro-rgb") engine, unmodified, for comparison. */
export function runLegacyPipeline(image: LabImage, settings: HalftoneSettings = DEFAULT_HALFTONE_SETTINGS): LegacyRunResult {
  const start = now();
  const layers = runHalftoneEngine(image.data, image.width, image.height, settings);
  const timeMs = now() - start;

  const buffer: RasterBuffer = { data: new Uint8ClampedArray(image.width * image.height * 4), width: image.width, height: image.height };
  if (layers.whiteSolidCoverage) paintCoverageGrid(buffer, layers.whiteSolidCoverage, CHANNEL_COLORS.white);
  else if (layers.whiteDots) paintDots(buffer, layers.whiteDots, CHANNEL_COLORS.white);
  // Legacy engine produces a single ink channel (grayscale coverage), rendered here in black —
  // it is NOT a real CMYK separation, only a luminance-based mono ink layer + White Underbase.
  paintDots(buffer, layers.colorDots, [30, 30, 30]);

  return { layers, preview: buffer, timeMs };
}

/** Runs the new independent CMYK(+White) engine, unmodified, for comparison. */
export function runCmykPipeline(image: LabImage, settings: PrintEngineSettings = DEFAULT_PRINT_ENGINE_SETTINGS): CmykRunResult {
  const start = now();
  const layers = buildPrintLayerSet(image.data, image.width, image.height, settings);
  const timeMs = now() - start;
  const separationChannels = separateRgbToCmyk(image.data, image.width, image.height, settings.color).channels;
  const preview = composePrintPreview(layers);
  return { layers, separationChannels, preview, timeMs };
}

/** Renders a single channel in isolation (no other ink/White painted), for visual per-channel inspection. */
export function renderChannelPreview(layers: PrintLayerSet, channel: ChannelName): RasterBuffer {
  const { width, height } = layers;
  const buffer: RasterBuffer = { data: new Uint8ClampedArray(width * height * 4), width, height };

  if (channel === "alpha") {
    for (let i = 0; i < width * height; i++) {
      const v = Math.round(Math.max(0, Math.min(1, layers.alpha[i])) * 255);
      buffer.data[i * 4] = v;
      buffer.data[i * 4 + 1] = v;
      buffer.data[i * 4 + 2] = v;
      buffer.data[i * 4 + 3] = 255;
    }
    return buffer;
  }

  if (channel === "white") {
    if (layers.white.mode === "solid" && layers.white.coverage) paintCoverageGrid(buffer, layers.white.coverage, CHANNEL_COLORS.white);
    else if (layers.white.mode === "halftone" && layers.white.dots) paintDots(buffer, layers.white.dots, CHANNEL_COLORS.white);
    return buffer;
  }

  paintDots(buffer, layers[channel], CHANNEL_COLORS[channel]);
  return buffer;
}

export function computeCoverageStats(coverage: Float32Array): CoverageStats {
  let sum = 0,
    min = Infinity,
    max = -Infinity;
  for (let i = 0; i < coverage.length; i++) {
    const v = coverage[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const n = coverage.length || 1;
  return { avg: sum / n, min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}

export function whiteDotOrCellCount(layers: PrintLayerSet): number {
  if (layers.white.mode === "halftone" && layers.white.dots) return layers.white.dots.length;
  if (layers.white.mode === "solid" && layers.white.coverage) return layers.white.coverage.data.filter((v) => v > 0).length;
  return 0;
}

/** Runs both pipelines on the same input and collects the metrics required by PASSO 6E section 14. */
export function runComparison(image: LabImage, legacySettings: HalftoneSettings = DEFAULT_HALFTONE_SETTINGS, cmykSettings: PrintEngineSettings = DEFAULT_PRINT_ENGINE_SETTINGS) {
  const legacy = runLegacyPipeline(image, legacySettings);
  const cmyk = runCmykPipeline(image, cmykSettings);

  const heapUsedMB = typeof process !== "undefined" ? process.memoryUsage().heapUsed / (1024 * 1024) : 0;

  const metrics: LabMetrics = {
    legacyTimeMs: legacy.timeMs,
    cmykTimeMs: cmyk.timeMs,
    heapUsedMB,
    dots: {
      cyan: cmyk.layers.cyan.length,
      magenta: cmyk.layers.magenta.length,
      yellow: cmyk.layers.yellow.length,
      black: cmyk.layers.black.length,
      white: whiteDotOrCellCount(cmyk.layers),
      legacyColor: legacy.layers.colorDots.length,
      legacyWhite: legacy.layers.whiteDots?.length ?? (legacy.layers.whiteSolidCoverage?.data.filter((v) => v > 0).length ?? 0),
    },
    coverage: {
      cyan: computeCoverageStats(cmyk.separationChannels.cyan),
      magenta: computeCoverageStats(cmyk.separationChannels.magenta),
      yellow: computeCoverageStats(cmyk.separationChannels.yellow),
      black: computeCoverageStats(cmyk.separationChannels.black),
    },
  };

  return { legacy, cmyk, metrics };
}

export { DEFAULT_HALFTONE_SETTINGS, DEFAULT_PRINT_ENGINE_SETTINGS };
