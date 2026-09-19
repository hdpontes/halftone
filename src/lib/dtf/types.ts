/**
 * Integration types for PASSO 6C — combines CMYK screening (6A/6B) with the
 * existing White Underbase pipeline into a single logical print layer set.
 * Canvas-free: reuses DotDescriptor from halftone/types instead of a new point type.
 */
import type { CoverageGrid, DotDescriptor, DotShape, HalftoneAlgorithm, WhiteMode } from "../halftone/types";
import type { ColorSeparationSettings } from "../color/separation";
import type { CmykScreenSettings } from "../color/screening";

/**
 * Represents whatever buildWhiteUnderbase() actually produced (PASSO 6D fix):
 * a continuous coverage grid for "solid" mode, or dots for "halftone" mode —
 * never both, and never forced into one shape. `mode` reuses the existing
 * WhiteMode union ("none"|"solid"|"halftone") instead of a narrower duplicate.
 */
export interface WhiteLayer {
  mode: WhiteMode;
  /** Present only when mode === "solid" (reuses CoverageGrid, incl. cellPx, as returned by buildWhiteUnderbase). */
  coverage?: CoverageGrid;
  /** Present only when mode === "halftone". */
  dots?: DotDescriptor[];
  width: number;
  height: number;
}

export interface PrintLayerSet {
  cyan: DotDescriptor[];
  magenta: DotDescriptor[];
  yellow: DotDescriptor[];
  black: DotDescriptor[];
  white: WhiteLayer;

  /** Raw art alpha (0..1), unmultiplied — independent from every channel above. */
  alpha: Float32Array;

  width: number;
  height: number;
  dpi: number;
}

/** Subset of HalftoneSettings' white-related fields, reused rather than duplicated. */
export interface WhiteSettings {
  whiteMode: WhiteMode;
  whiteDensity: number;
  whiteChoke: number;
  whiteLpi: number;
  whiteAngle: number;
  whiteDotShape: DotShape;
  whiteAlgorithm: HalftoneAlgorithm;
  whiteGamma: number;
  minDot: number;
  maxDot: number;
  hybridThreshold: number;
}

export interface PrintEngineSettings {
  dpi: number;
  color: ColorSeparationSettings;
  cmyk: CmykScreenSettings;
  white: WhiteSettings;
}
