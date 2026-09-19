import type { HalftoneSettings } from "./types";

// Radius of a dot at 100% coverage, as a fraction of the grid cell size.
// 0.62 keeps neighbouring dots from touching at moderate angles while still
// reading as "solid" in shadows (matches the value tuned in the legacy engine).
export const MAX_RADIUS_FACTOR = 0.62;

// Supersampling factor used by the shared dot-tile cache for anti-aliased edges.
export const SS_FACTOR = 4;
export const SS_BUCKET_STEPS = 48;

// FM/stochastic engine: fixed micro-dot pitch in device pixels, independent of LPI.
export const FM_MICRO_PITCH_PX = 3.2;

export const DEFAULT_HALFTONE_SETTINGS: HalftoneSettings = {
  dpi: 300,
  lpi: 32,
  angle: 22.5,
  algorithm: "am",
  dotShape: "round",
  colorMode: "rgb",

  gamma: 1.8,
  blackPoint: 16,
  whitePoint: 110,
  dotGain: 0,
  gain: 1,

  minDot: 0.015,
  maxDot: 1,
  hybridThreshold: 0.35,
  hybridBlendWidth: 0.1,

  whiteMode: "none",
  whiteDensity: 1,
  whiteChoke: 2,
  whiteLpi: 45,
  whiteAngle: 67.5,
  whiteDotShape: "round",
  whiteAlgorithm: "am",
  whiteGamma: 1,

  dustRemoval: true,
  cleanupMinDotPx: 0.18,

  previewQuality: "full",
};

export function validateDpiLpi(dpi: number, lpi: number): { ok: boolean; message?: string } {
  if (dpi >= lpi * 2) return { ok: true };
  return {
    ok: false,
    message: `DPI (${dpi}) deveria ser ao menos 2x o LPI (${lpi}) para evitar perda de detalhe do ponto. Sugestão: DPI >= ${lpi * 2}.`,
  };
}
