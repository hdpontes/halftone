function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/** Classic levels adjustment: black/white point + gamma, operating on 0-255 luminance. */
export function applyLevels(v: number, blackPoint: number, whitePoint: number, gamma: number): number {
  const white = Math.max(blackPoint + 1, whitePoint);
  const g = Math.max(0.1, gamma);
  let t = clamp((v - blackPoint) / (white - blackPoint), 0, 1);
  t = Math.pow(t, 1 / g);
  return t * 255;
}

/**
 * Press dot-gain curve: simulates ink/emulsion spreading on film/fabric.
 * Peaks at midtone coverage (50%) and fades to zero at 0%/100%, matching real dot gain behavior.
 */
export function applyDotGain(coverage: number, dotGainFraction: number): number {
  if (dotGainFraction === 0) return coverage;
  return clamp(coverage + dotGainFraction * Math.sin(Math.PI * coverage), 0, 1);
}

/** Converts a raw 0-255 luminance sample into a 0..1 ink coverage value using the full tone pipeline. */
export function luminanceToCoverage(rawLuminance: number, opts: { blackPoint: number; whitePoint: number; gamma: number; dotGain: number; gain: number }): number {
  const L = applyLevels(rawLuminance, opts.blackPoint, opts.whitePoint, opts.gamma);
  let coverage = 1 - L / 255;
  coverage = clamp(coverage * opts.gain, 0, 1);
  coverage = applyDotGain(coverage, opts.dotGain);
  return coverage;
}

export { clamp };
