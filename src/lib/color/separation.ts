/**
 * Mathematical CMYK separation (PASSO 6A).
 *
 * This module converts RGBA pixel data into four independent, per-pixel ink
 * coverage channels (Cyan, Magenta, Yellow, Black) plus a separate Alpha
 * channel. It is a purely mathematical RGB -> CMYK separation (RGB -> CMY,
 * then a parametrized black generation / GCR / UCR / TAC pipeline) — it is
 * NOT equivalent to an ICC color-managed conversion and makes no attempt to
 * model ink/tecido gamut, dot gain, or printer response. See PASSO 5's
 * architecture notes for where an ICC-based strategy could later be plugged
 * in behind the same output shape.
 *
 * Canvas-free: works on Float32Array buffers only. Callers extract
 * Uint8ClampedArray RGBA pixel data (e.g. from a canvas ImageData) and get
 * back plain typed arrays here; rendering/exporting remains a separate
 * concern (compose.ts/export.ts), same convention as the halftone engine.
 */

export interface ColorChannels {
  cyan: Float32Array;
  magenta: Float32Array;
  yellow: Float32Array;
  black: Float32Array;
}

export interface ColorSeparationResult {
  channels: ColorChannels;
  alpha: Float32Array;
  width: number;
  height: number;
}

export interface ColorSeparationSettings {
  /** Master enable/intensity for black generation, 0..1. 0 = no K is ever generated (pure RGB->CMY). */
  blackGeneration: number;
  /** How much of the shared gray component (min(C,M,Y)) becomes K, 0..1. 0 = GCR off, 1 = GCR at its configured maximum. */
  gcrStrength: number;
  /** How aggressively residual CMY gray is removed in shadows/neutrals in favor of K, 0..1. */
  ucrStrength: number;
  /** Total Area Coverage limit for C+M+Y+K, e.g. 3.2 = 320%. Does NOT include White. */
  maxTac: number;
  /** Tonal point (0..1, based on the gray component) below which K generation stays near zero. */
  blackStart: number;
  /** Hard cap on the K channel, 0..1. */
  blackMax: number;
  /** When true, dampens black generation for highly saturated colors to avoid dirtying pure/near-pure hues. */
  preserveSaturatedColors: boolean;
}

export const DEFAULT_COLOR_SEPARATION_SETTINGS: ColorSeparationSettings = {
  blackGeneration: 1,
  gcrStrength: 0.6,
  ucrStrength: 0.35,
  maxTac: 3.2,
  blackStart: 0.25,
  blackMax: 1.0,
  preserveSaturatedColors: true,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 >= edge1) return x < edge1 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * K generation. Starts from the classic "gray component" shared by C/M/Y
 * (min(C,M,Y)) but does NOT use it directly as K — it shapes it with
 * blackStart (tonal onset), gcrStrength (how much of it converts to K),
 * blackMax (hard cap) and an optional saturation-based dampening so vivid
 * primary/secondary colors aren't muddied with unnecessary black.
 */
export function generateBlackComponent(c: number, m: number, y: number, settings: ColorSeparationSettings): number {
  if (settings.blackGeneration <= 0) return 0;
  const gray = Math.min(c, m, y);
  if (gray <= 0) return 0;

  const ramp = smoothstep(settings.blackStart, 1, gray);
  const satRange = Math.max(c, m, y) - Math.min(c, m, y); // 0 = neutral gray, 1 = fully saturated hue
  const saturationDampen = settings.preserveSaturatedColors ? 1 - satRange : 1;

  const raw = gray * ramp * settings.gcrStrength * saturationDampen * settings.blackGeneration;
  return clamp01(Math.min(raw, settings.blackMax));
}

/** GCR: once K has been generated, remove the equivalent amount from C/M/Y (never below 0). */
function reduceCmyForBlack(c: number, m: number, y: number, k: number): { c: number; m: number; y: number } {
  return { c: clamp01(c - k), m: clamp01(m - k), y: clamp01(y - k) };
}

/**
 * UCR: independent from GCR, targets the gray still remaining in C/M/Y after
 * GCR, weighted toward shadow/neutral tones (shadowWeight grows as the
 * original gray component approaches 1) — highlights/midtones are barely
 * touched.
 */
export function applyUcr(
  c: number,
  m: number,
  y: number,
  k: number,
  originalGray: number,
  settings: ColorSeparationSettings
): { c: number; m: number; y: number; k: number } {
  if (settings.ucrStrength <= 0) return { c, m, y, k };
  const shadowWeight = smoothstep(0.5, 1, originalGray);
  if (shadowWeight <= 0) return { c, m, y, k };

  const remainingGray = Math.min(c, m, y);
  if (remainingGray <= 0) return { c, m, y, k };

  const ucrAmount = remainingGray * settings.ucrStrength * shadowWeight;
  return {
    c: clamp01(c - ucrAmount),
    m: clamp01(m - ucrAmount),
    y: clamp01(y - ucrAmount),
    k: clamp01(Math.min(k + ucrAmount, settings.blackMax)),
  };
}

/**
 * TAC limit: caps C+M+Y+K to maxTac. Preserves K when possible by reducing
 * C/M/Y proportionally first (keeps their relative ratio, so hue is
 * preserved); only reduces K as a last resort if CMY alone can't absorb the
 * excess. White is intentionally excluded from this calculation.
 */
export function applyTacLimit(
  c: number,
  m: number,
  y: number,
  k: number,
  maxTac: number
): { c: number; m: number; y: number; k: number } {
  const total = c + m + y + k;
  const excess = total - maxTac;
  if (excess <= 0) return { c, m, y, k };

  const cmySum = c + m + y;
  if (cmySum > 0) {
    const reducibleFromCmy = Math.min(excess, cmySum);
    const scale = (cmySum - reducibleFromCmy) / cmySum;
    const c2 = c * scale;
    const m2 = m * scale;
    const y2 = y * scale;
    const remainingExcess = excess - reducibleFromCmy;
    const k2 = remainingExcess > 0 ? Math.max(0, k - remainingExcess) : k;
    return { c: c2, m: m2, y: y2, k: k2 };
  }
  return { c, m, y, k: Math.max(0, k - excess) };
}

/**
 * RGBA -> C/M/Y/K + Alpha, in a single pass over the source pixel buffer.
 * No screening is performed here (see PASSO 5's `screen/channel.ts` proposal
 * for the next step) — this function only produces coverage channels.
 */
export function separateRgbToCmyk(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: Partial<ColorSeparationSettings> = {}
): ColorSeparationResult {
  const cfg: ColorSeparationSettings = { ...DEFAULT_COLOR_SEPARATION_SETTINGS, ...settings };

  const count = width * height;
  const cyan = new Float32Array(count);
  const magenta = new Float32Array(count);
  const yellow = new Float32Array(count);
  const black = new Float32Array(count);
  const alpha = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = rgba[o] / 255;
    const g = rgba[o + 1] / 255;
    const b = rgba[o + 2] / 255;
    const a = rgba[o + 3] / 255;

    // RGB -> CMY (no luminance shortcut — each ink channel is derived directly from its own RGB complement).
    const c0 = 1 - r;
    const m0 = 1 - g;
    const y0 = 1 - b;
    const gray = Math.min(c0, m0, y0);

    const k0 = generateBlackComponent(c0, m0, y0, cfg);
    const gcr = reduceCmyForBlack(c0, m0, y0, k0);
    const ucr = applyUcr(gcr.c, gcr.m, gcr.y, k0, gray, cfg);
    const tac = applyTacLimit(ucr.c, ucr.m, ucr.y, ucr.k, cfg.maxTac);

    // Alpha stays a separate, independent signal — it scales ink coverage, it never becomes an ink channel itself.
    cyan[i] = clamp01(tac.c) * a;
    magenta[i] = clamp01(tac.m) * a;
    yellow[i] = clamp01(tac.y) * a;
    black[i] = clamp01(tac.k) * a;
    alpha[i] = a;
  }

  return { channels: { cyan, magenta, yellow, black }, alpha, width, height };
}
