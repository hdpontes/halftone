import { generateDots } from "./halftone";
import { luminanceToCoverage } from "./gamma";
import { buildWhiteUnderbase } from "./white";
import { removeDustDots } from "./cleanup";
import type { HalftoneLayers, HalftoneSettings } from "./types";

function lum(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Pure, canvas-free pipeline: RGBA pixels + settings -> dot lists / white mask.
 * ARTE ORIGINAL -> (caller does pré-processamento/remoção de fundo) -> MÁSCARA DA
 * ARTE (alpha) -> CANAL DE COR -> CANAL WHITE UNDERBASE -> CHOKE DO WHITE ->
 * HALFTONE DA COR -> HALFTONE DO BRANCO. Composition/export happen in
 * compose.ts/export.ts (canvas-dependent), kept out of this module on purpose.
 */
export function runHalftoneEngine(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  settings: HalftoneSettings,
  opts?: { isProtected?: (r: number, g: number, b: number) => boolean }
): HalftoneLayers {
  const cellPx = Math.max(1.1, settings.dpi / settings.lpi);
  const isProtected = opts?.isProtected;

  const sampleCoverage = (px: number, py: number) => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(px)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(py)));
    const i = (iy * width + ix) * 4;
    const a = data[i + 3] / 255;
    if (a <= 0.02) return 0;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (isProtected && isProtected(r, g, b)) return 0;
    const rawL = lum(r, g, b);
    const coverage = luminanceToCoverage(rawL, {
      blackPoint: settings.blackPoint,
      whitePoint: settings.whitePoint,
      gamma: settings.gamma,
      dotGain: settings.dotGain,
      gain: settings.gain,
    });
    return coverage * a;
  };

  let colorDots = generateDots(settings.algorithm, sampleCoverage, width, height, cellPx, settings.angle, settings.dotShape, settings);
  colorDots = removeDustDots(colorDots, settings.cleanupMinDotPx, settings.dustRemoval);

  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3];
  const white = buildWhiteUnderbase(alpha, width, height, settings);
  const whiteDots = white.dots ? removeDustDots(white.dots, settings.cleanupMinDotPx, settings.dustRemoval) : null;

  return {
    width,
    height,
    dpi: settings.dpi,
    colorDots,
    whiteDots,
    whiteSolidCoverage: white.solidCoverage,
  };
}
