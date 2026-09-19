/**
 * Independent per-channel screening for the CMYK Color Engine (PASSO 6B).
 *
 * Takes the C/M/Y/K coverage channels produced by `separation.ts` (PASSO 6A)
 * and screens each one independently into dots, reusing the existing
 * AM/FM/Hybrid engines unchanged (`generateDots()` in halftone/halftone.ts).
 * No RGB/luminance recomputation happens here, and channels are never
 * blended together before screening — each channel keeps its own lpi,
 * angle, gamma, dotGain, algorithm and dot shape.
 */
import { generateDots } from "../halftone/halftone";
import { applyDotGain, clamp } from "../halftone/gamma";
import { DEFAULT_HALFTONE_SETTINGS } from "../halftone/constants";
import type { CoverageSampler, DotDescriptor, DotShape, HalftoneAlgorithm } from "../halftone/types";
import type { ColorChannels } from "./separation";

export interface ChannelScreenSettings {
  lpi: number;
  angle: number;
  gamma: number;
  dotGain: number; // fraction, e.g. 0.15 = +15%

  algorithm: HalftoneAlgorithm;
  dotShape: DotShape;

  hybridThreshold?: number; // 0..1, only used when algorithm === "hybrid"
  hybridBlendWidth?: number; // 0..1, only used when algorithm === "hybrid"
}

export interface CmykScreenSettings {
  cyan: ChannelScreenSettings;
  magenta: ChannelScreenSettings;
  yellow: ChannelScreenSettings;
  black: ChannelScreenSettings;
}

export interface ScreenedColorChannels {
  cyanDots: DotDescriptor[];
  magentaDots: DotDescriptor[];
  yellowDots: DotDescriptor[];
  blackDots: DotDescriptor[];
  width: number;
  height: number;
}

/**
 * Default per-channel screening configuration. This is a starting preset,
 * not a mandated physical rule — every field is independently overridable
 * per channel. Angles follow the common offset-print convention (spread to
 * reduce moiré) purely as a sensible default.
 */
export const DEFAULT_CMYK_SCREEN_SETTINGS: CmykScreenSettings = {
  cyan: { lpi: 45, angle: 15, gamma: 1, dotGain: 0, algorithm: "am", dotShape: "round" },
  magenta: { lpi: 45, angle: 75, gamma: 1, dotGain: 0, algorithm: "am", dotShape: "round" },
  yellow: { lpi: 45, angle: 0, gamma: 1, dotGain: 0, algorithm: "am", dotShape: "round" },
  black: { lpi: 45, angle: 45, gamma: 1, dotGain: 0, algorithm: "am", dotShape: "round" },
};

/** Reads coverage from the channel array and applies this channel's own gamma + dot gain (0..1 in, 0..1 out). */
function makeChannelSampler(coverage: Float32Array, width: number, height: number, settings: ChannelScreenSettings): CoverageSampler {
  const g = settings.gamma > 0 ? settings.gamma : 1;
  return (px: number, py: number) => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(px)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(py)));
    const raw = clamp(coverage[iy * width + ix], 0, 1);
    const toned = Math.pow(raw, 1 / g); // same convention as white.ts's whiteGamma
    return applyDotGain(toned, settings.dotGain || 0);
  };
}

/**
 * Screens a single channel's coverage into dots, dispatching to the existing
 * AM/FM/Hybrid engines. Does not read/modify Alpha or any other channel —
 * `coverage` is assumed to already reflect the effective (alpha-multiplied)
 * ink coverage, matching PASSO 6A's `separateRgbToCmyk()` output contract.
 */
export function screenChannel(coverage: Float32Array, width: number, height: number, dpi: number, settings: ChannelScreenSettings): DotDescriptor[] {
  const lpi = settings.lpi > 0 ? settings.lpi : DEFAULT_HALFTONE_SETTINGS.lpi;
  const cellPx = Math.max(1.1, dpi / lpi);
  const sampleCoverage = makeChannelSampler(coverage, width, height, settings);
  return generateDots(settings.algorithm, sampleCoverage, width, height, cellPx, settings.angle, settings.dotShape, {
    minDot: DEFAULT_HALFTONE_SETTINGS.minDot,
    maxDot: DEFAULT_HALFTONE_SETTINGS.maxDot,
    hybridThreshold: settings.hybridThreshold ?? DEFAULT_HALFTONE_SETTINGS.hybridThreshold,
    hybridBlendWidth: settings.hybridBlendWidth ?? DEFAULT_HALFTONE_SETTINGS.hybridBlendWidth,
  });
}

/** Screens all four CMYK channels independently. Never mixes channels before or during screening. */
export function screenCmykChannels(channels: ColorChannels, width: number, height: number, dpi: number, settings: CmykScreenSettings): ScreenedColorChannels {
  return {
    cyanDots: screenChannel(channels.cyan, width, height, dpi, settings.cyan),
    magentaDots: screenChannel(channels.magenta, width, height, dpi, settings.magenta),
    yellowDots: screenChannel(channels.yellow, width, height, dpi, settings.yellow),
    blackDots: screenChannel(channels.black, width, height, dpi, settings.black),
    width,
    height,
  };
}
