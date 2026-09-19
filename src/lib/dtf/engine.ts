/**
 * PASSO 6C — builds the integrated PrintLayerSet: RGB->CMYK separation (6A),
 * independent per-channel screening (6B), and the existing White Underbase
 * pipeline (halftone/white.ts), reused as-is. Modular steps, no monolith.
 */
import { separateRgbToCmyk, DEFAULT_COLOR_SEPARATION_SETTINGS } from "../color/separation";
import { screenCmykChannels, DEFAULT_CMYK_SCREEN_SETTINGS } from "../color/screening";
import { buildWhiteUnderbase } from "../halftone/white";
import { DEFAULT_HALFTONE_SETTINGS } from "../halftone/constants";
import type { HalftoneSettings } from "../halftone/types";
import type { PrintEngineSettings, PrintLayerSet, WhiteLayer, WhiteSettings } from "./types";

export const DEFAULT_WHITE_SETTINGS: WhiteSettings = {
  whiteMode: "halftone",
  whiteDensity: DEFAULT_HALFTONE_SETTINGS.whiteDensity,
  whiteChoke: DEFAULT_HALFTONE_SETTINGS.whiteChoke,
  whiteLpi: DEFAULT_HALFTONE_SETTINGS.whiteLpi,
  whiteAngle: DEFAULT_HALFTONE_SETTINGS.whiteAngle,
  whiteDotShape: DEFAULT_HALFTONE_SETTINGS.whiteDotShape,
  whiteAlgorithm: DEFAULT_HALFTONE_SETTINGS.whiteAlgorithm,
  whiteGamma: DEFAULT_HALFTONE_SETTINGS.whiteGamma,
  minDot: DEFAULT_HALFTONE_SETTINGS.minDot,
  maxDot: DEFAULT_HALFTONE_SETTINGS.maxDot,
  hybridThreshold: DEFAULT_HALFTONE_SETTINGS.hybridThreshold,
};

export const DEFAULT_PRINT_ENGINE_SETTINGS: PrintEngineSettings = {
  dpi: DEFAULT_HALFTONE_SETTINGS.dpi,
  color: DEFAULT_COLOR_SEPARATION_SETTINGS,
  cmyk: DEFAULT_CMYK_SCREEN_SETTINGS,
  white: DEFAULT_WHITE_SETTINGS,
};

/**
 * Builds the White layer exactly as buildWhiteUnderbase() (halftone/white.ts) produces it,
 * unmodified — Alpha -> coverage -> Choke -> density -> gamma -> whiteMode -> solid OR halftone.
 * `settings.white.whiteMode` decides the shape (PASSO 6D: no forced "halftone" remap anymore).
 */
function buildWhiteLayer(data: Uint8ClampedArray, width: number, height: number, dpi: number, white: WhiteSettings): WhiteLayer {
  if (white.whiteMode === "none") return { mode: "none", width, height };

  const alpha8 = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) alpha8[i] = data[i * 4 + 3];

  const settings: HalftoneSettings = {
    ...DEFAULT_HALFTONE_SETTINGS,
    dpi,
    whiteMode: white.whiteMode,
    whiteDensity: white.whiteDensity,
    whiteChoke: white.whiteChoke,
    whiteLpi: white.whiteLpi,
    whiteAngle: white.whiteAngle,
    whiteDotShape: white.whiteDotShape,
    whiteAlgorithm: white.whiteAlgorithm,
    whiteGamma: white.whiteGamma,
    minDot: white.minDot,
    maxDot: white.maxDot,
    hybridThreshold: white.hybridThreshold,
  };
  const result = buildWhiteUnderbase(alpha8, width, height, settings);

  if (white.whiteMode === "solid") {
    return { mode: "solid", coverage: result.solidCoverage ?? undefined, width, height };
  }
  return { mode: "halftone", dots: result.dots ?? [], width, height };
}

/**
 * RGBA -> CMYK separation -> per-channel screening -> White Underbase -> PrintLayerSet.
 * No color recomputation happens after step 2; alpha (from separation.ts) is reused as-is,
 * never recomputed and never multiplied into a channel a second time.
 */
export function buildPrintLayerSet(data: Uint8ClampedArray, width: number, height: number, settings: PrintEngineSettings): PrintLayerSet {
  const separated = separateRgbToCmyk(data, width, height, settings.color);
  const screened = screenCmykChannels(separated.channels, width, height, settings.dpi, settings.cmyk);
  const white = buildWhiteLayer(data, width, height, settings.dpi, settings.white);

  return {
    cyan: screened.cyanDots,
    magenta: screened.magentaDots,
    yellow: screened.yellowDots,
    black: screened.blackDots,
    white,
    alpha: separated.alpha,
    width,
    height,
    dpi: settings.dpi,
  };
}
