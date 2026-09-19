import { generateAmDots } from "./am";
import { generateFmDots } from "./fm";
import type { CoverageSampler, DotDescriptor, DotShape, HalftoneSettings } from "./types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Hybrid engine: FM carries tone below `hybridThreshold`, AM carries it at/above.
 * Instead of a hard per-cell cutoff (which produced an abrupt, perceptible change
 * of *texture* right at the threshold — confirmed in the PASSO 3 audit), each
 * engine's input coverage is cross-faded over a `hybridBlendWidth`-wide band
 * centered on the threshold: amWeight + fmWeight = 1 at every coverage value, so
 * the two engines' *scaled* coverage still sums to the original coverage — no
 * extra ink is added just because a pixel falls inside the blend band.
 */
export function generateHybridDots(
  sampleCoverage: CoverageSampler,
  width: number,
  height: number,
  cellPx: number,
  angleDeg: number,
  shape: DotShape,
  opts: Pick<HalftoneSettings, "minDot" | "maxDot" | "hybridThreshold" | "hybridBlendWidth">
): DotDescriptor[] {
  const threshold = Math.max(opts.minDot, Math.min(opts.maxDot, opts.hybridThreshold));
  const blendWidth = Math.max(0, opts.hybridBlendWidth ?? 0.1);
  const lo = threshold - blendWidth / 2;
  const hi = threshold + blendWidth / 2;

  const amWeightAt = (coverage: number) => (blendWidth <= 1e-6 ? (coverage >= threshold ? 1 : 0) : smoothstep(lo, hi, coverage));

  const amSample: CoverageSampler = (px, py) => {
    const c = sampleCoverage(px, py);
    return c * amWeightAt(c);
  };
  const fmSample: CoverageSampler = (px, py) => {
    const c = sampleCoverage(px, py);
    return c * (1 - amWeightAt(c));
  };

  const amDots = generateAmDots(amSample, width, height, cellPx, angleDeg, shape, { minDot: opts.minDot, maxDot: opts.maxDot });
  const fmDots = generateFmDots(fmSample, width, height, angleDeg, shape, { minDot: opts.minDot, maxDot: opts.maxDot });
  return amDots.concat(fmDots);
}
