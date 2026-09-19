import type { DotDescriptor } from "./types";

/**
 * Removes dots below a minimum printable radius. Kept as an explicit, separate
 * step (rather than baked silently into am/fm) so it's a documented, optional
 * pipeline stage instead of an implicit filter — matches `dustRemoval`/`cleanupMinDotPx`.
 */
export function removeDustDots(dots: DotDescriptor[], minRadiusPx: number, enabled: boolean): DotDescriptor[] {
  if (!enabled) return dots;
  return dots.filter((d) => d.radius >= minRadiusPx);
}
