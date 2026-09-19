import { generateAmDots } from "./am";
import { generateFmDots } from "./fm";
import { generateHybridDots } from "./hybrid";
import type { CoverageSampler, DotDescriptor, DotShape, HalftoneAlgorithm, HalftoneSettings } from "./types";

/** Single entry point that dispatches to AM/FM/Hybrid based on `algorithm`. */
export function generateDots(
  algorithm: HalftoneAlgorithm,
  sampleCoverage: CoverageSampler,
  width: number,
  height: number,
  cellPx: number,
  angleDeg: number,
  shape: DotShape,
  settings: Pick<HalftoneSettings, "minDot" | "maxDot" | "hybridThreshold" | "hybridBlendWidth">
): DotDescriptor[] {
  if (algorithm === "am") return generateAmDots(sampleCoverage, width, height, cellPx, angleDeg, shape, settings);
  if (algorithm === "fm") return generateFmDots(sampleCoverage, width, height, angleDeg, shape, settings);
  return generateHybridDots(sampleCoverage, width, height, cellPx, angleDeg, shape, settings);
}
