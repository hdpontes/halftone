import { DEFAULT_HALFTONE_SETTINGS } from "./constants";
import type { HalftoneSettings } from "./types";

/**
 * Presets only fill in settings — no duplicated algorithms. Each preset is a
 * partial override merged on top of DEFAULT_HALFTONE_SETTINGS.
 */
export const DTF_PRESETS: Record<string, Partial<HalftoneSettings>> = {
  "DTF Standard": { algorithm: "am", lpi: 40, dotShape: "round", whiteMode: "none" },
  "DTF Detail": { algorithm: "hybrid", lpi: 55, hybridThreshold: 0.28, dotShape: "round", whiteMode: "none" },
  "DTF Soft": { algorithm: "am", lpi: 32, dotGain: -0.08, gain: 0.9, whiteMode: "none" },
  "DTF Strong": { algorithm: "am", lpi: 32, dotGain: 0.12, gain: 1.15, whiteMode: "none" },
  "DTF White Solid": { whiteMode: "solid", whiteDensity: 1, whiteChoke: 2 },
  "DTF White Halftone": { whiteMode: "halftone", whiteAlgorithm: "am", whiteLpi: 45, whiteAngle: 67.5, whiteDensity: 0.9, whiteChoke: 2 },
};

export function resolvePreset(name: string): HalftoneSettings {
  const overrides = DTF_PRESETS[name] || {};
  return { ...DEFAULT_HALFTONE_SETTINGS, ...overrides };
}
