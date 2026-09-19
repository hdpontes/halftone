import { FM_MICRO_PITCH_PX } from "./constants";
import { cellHash, forEachGridCell } from "./sampling";
import type { CoverageSampler, DotDescriptor, DotShape } from "./types";

/**
 * Frequency Modulation (FM) / stochastic engine: a fixed fine micro-dot pitch
 * (independent of LPI) with per-micro-cell placement decided by comparing the
 * local tonal coverage against a deterministic hash-derived threshold. This is
 * an ordered/void-and-cluster-style stochastic screen: same input always
 * produces the same dot pattern (no Math.random), while dot *density* still
 * follows tone, which is what gives FM screens their grain-like look.
 */
export function generateFmDots(
  sampleCoverage: CoverageSampler,
  width: number,
  height: number,
  angleDeg: number,
  shape: DotShape,
  opts: { minDot: number; maxDot: number; microPitchPx?: number }
): DotDescriptor[] {
  const pitch = opts.microPitchPx ?? FM_MICRO_PITCH_PX;
  const dots: DotDescriptor[] = [];
  const radius = pitch * 0.42;
  forEachGridCell(width, height, pitch, angleDeg, ({ gx, gy, px, py }) => {
    const coverage = Math.max(0, Math.min(opts.maxDot, sampleCoverage(px, py)));
    if (coverage < opts.minDot) return;
    const threshold = cellHash(gx, gy);
    if (coverage <= threshold) return;
    // Slight radius variation with coverage keeps very light/heavy tones distinguishable
    // even though placement (not size) is the primary carrier of tone in FM screening.
    const r = radius * (0.72 + 0.28 * coverage);
    dots.push({ x: px, y: py, radius: r, shape });
  });
  return dots;
}
