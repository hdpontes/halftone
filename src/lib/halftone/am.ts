import { MAX_RADIUS_FACTOR } from "./constants";
import { forEachGridCell } from "./sampling";
import type { CoverageSampler, DotDescriptor, DotShape, HalftoneSettings } from "./types";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Amplitude Modulation (AM) engine: dot AREA follows tonal coverage on a fixed
 * angled grid. Area (not just a linear radius) is what must match coverage
 * for the eye to perceive the right tone, so radius = maxRadius * sqrt(coverage).
 */
export function generateAmDots(
  sampleCoverage: CoverageSampler,
  width: number,
  height: number,
  cellPx: number,
  angleDeg: number,
  shape: DotShape,
  opts: Pick<HalftoneSettings, "minDot" | "maxDot">
): DotDescriptor[] {
  const dots: DotDescriptor[] = [];
  const maxRadius = cellPx * MAX_RADIUS_FACTOR;
  forEachGridCell(width, height, cellPx, angleDeg, ({ px, py }) => {
    const raw = sampleCoverage(px, py);
    const coverage = clamp(raw, 0, opts.maxDot);
    if (coverage < opts.minDot) return;
    const radius = maxRadius * Math.sqrt(coverage);
    if (radius < 0.18) return;
    dots.push({ x: px, y: py, radius, shape });
  });
  return dots;
}
