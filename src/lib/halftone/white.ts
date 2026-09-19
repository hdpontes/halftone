import { buildCoverageGridFromAlpha, chokeCoverageGrid, sampleCoverageGrid } from "./choke";
import { generateDots } from "./halftone";
import type { CoverageGrid, DotDescriptor, HalftoneSettings } from "./types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export interface WhiteResult {
  /** Continuous 0..1 coverage grid used directly as the white layer's alpha (whiteMode = "solid"). */
  solidCoverage: CoverageGrid | null;
  /** Halftoned white dots (whiteMode = "halftone"). */
  dots: DotDescriptor[] | null;
}

/**
 * Builds the White Underbase channel. IMPORTANT: this is fully independent from
 * the image's alpha/transparency channel conceptually — alpha only gates WHERE
 * ink can exist (the art's silhouette); whiteMask/whiteDensity control HOW MUCH
 * white ink is laid there. We still read the alpha channel as the *source* of
 * the silhouette (that's the only correct source for "where is the art"), but
 * the resulting coverage is a brand new value, never assigned back into alpha.
 */
export function buildWhiteUnderbase(alpha: Uint8ClampedArray, width: number, height: number, settings: HalftoneSettings): WhiteResult {
  if (settings.whiteMode === "none") return { solidCoverage: null, dots: null };

  // Grid cell size is capped small (2-4 source px) regardless of image size so `whiteChoke`
  // (measured in source pixels) stays accurate — a large downsample (as image size grows)
  // would otherwise make even a small choke value erode far more than requested.
  const downsample = Math.min(4, Math.max(2, Math.round(Math.min(width, height) / 3000)));
  const artMask = buildCoverageGridFromAlpha(alpha, width, height, downsample);
  const choked = chokeCoverageGrid(artMask, settings.whiteChoke);
  const density = clamp(settings.whiteDensity, 0, 1);
  const whiteGamma = settings.whiteGamma > 0 ? settings.whiteGamma : 1;

  // whiteMask = whiteCoverage(art, choked, whiteGamma) * whiteDensity — never alpha, never opacity.
  const densified: CoverageGrid = {
    data: choked.data.map((v) => Math.pow(clamp(v, 0, 1), 1 / whiteGamma) * density),
    width: choked.width,
    height: choked.height,
    cellPx: choked.cellPx,
  };

  if (settings.whiteMode === "solid") {
    return { solidCoverage: densified, dots: null };
  }

  const sampler = (px: number, py: number) => sampleCoverageGrid(densified, px, py);
  const cellPx = Math.max(1.1, settings.dpi / settings.whiteLpi);
  const dots = generateDots(settings.whiteAlgorithm, sampler, width, height, cellPx, settings.whiteAngle, settings.whiteDotShape, {
    minDot: settings.minDot,
    maxDot: settings.maxDot,
    hybridThreshold: settings.hybridThreshold,
    hybridBlendWidth: settings.hybridBlendWidth,
  });
  return { solidCoverage: null, dots };
}
