// Shared, canvas-free types for the DTF-grade halftone engine.
// Keeping these free of DOM types allows the core math (am/fm/hybrid/white/choke)
// to be unit-tested with plain Node (via tsx), no browser/DOM required.

export type HalftoneAlgorithm = "am" | "fm" | "hybrid";
export type DotShape = "round" | "diamond" | "square" | "ellipse" | "line" | "rosette";
export type WhiteMode = "none" | "solid" | "halftone";
export type ColorMode = "rgb" | "mono";
export type PreviewMode = "color" | "white" | "composite" | "final";

export interface HalftoneSettings {
  dpi: number;
  lpi: number;
  angle: number;
  algorithm: HalftoneAlgorithm;
  dotShape: DotShape;
  colorMode: ColorMode;

  gamma: number;
  blackPoint: number; // 0-254
  whitePoint: number; // 1-255
  dotGain: number; // fraction, e.g. 0.15 = +15%
  gain: number; // overall coverage multiplier (legacy "Força do ponto")

  minDot: number; // 0..1 coverage fraction below which a dot is not printed
  maxDot: number; // 0..1 coverage fraction cap (shadow clipping guard)
  hybridThreshold: number; // 0..1 coverage boundary between FM (below) and AM (at/above)
  hybridBlendWidth: number; // 0..1 width of the FM<->AM crossfade band centered on hybridThreshold (0 = hard cutoff)

  whiteMode: WhiteMode;
  whiteDensity: number; // 0..1
  whiteChoke: number; // pixels, geometric erosion of the white mask inward from the art edge
  whiteLpi: number;
  whiteAngle: number;
  whiteDotShape: DotShape;
  whiteAlgorithm: HalftoneAlgorithm;
  whiteGamma: number;

  dustRemoval: boolean;
  cleanupMinDotPx: number; // absolute px radius; dots smaller than this are dropped when dustRemoval is on

  previewQuality: "full" | "draft";
}

export interface DotDescriptor {
  x: number;
  y: number;
  radius: number;
  shape: DotShape;
}

// A coverage grid: 0 = no ink, 1 = full ink. Always continuous (never pre-binarized).
export interface CoverageGrid {
  data: Float32Array;
  width: number;
  height: number;
  /** Size in source-image pixels of one grid cell (grid is typically downsampled vs. source). */
  cellPx: number;
}

export interface HalftoneLayers {
  width: number;
  height: number;
  dpi: number;
  colorDots: DotDescriptor[];
  whiteDots: DotDescriptor[] | null; // populated only when whiteMode === "halftone"
  whiteSolidCoverage: CoverageGrid | null; // populated only when whiteMode === "solid"
}

export interface CoverageSampler {
  (px: number, py: number): number; // returns 0..1 coverage at source-image pixel coords
}
