import { FM_MICRO_PITCH_PX } from "./constants";
import { forEachGridCell } from "./sampling";
import type { CoverageSampler, DotDescriptor, DotShape } from "./types";

const BLUE_NOISE_SIZE = 32;
let blueNoiseTile: Float32Array | null = null;

function toroidalDistanceSq(ax: number, ay: number, bx: number, by: number, size: number): number {
  const dxRaw = Math.abs(ax - bx);
  const dyRaw = Math.abs(ay - by);
  const dx = Math.min(dxRaw, size - dxRaw);
  const dy = Math.min(dyRaw, size - dyRaw);
  return dx * dx + dy * dy;
}

function candidateXY(step: number, salt: number, size: number): [number, number] {
  // Deterministic low-discrepancy-ish candidate stream (no Math.random).
  let h = Math.imul(step + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  const x = h & (size - 1);
  const y = (h >>> 8) & (size - 1);
  return [x, y];
}

function buildBlueNoiseTile(size: number): Float32Array {
  const total = size * size;
  const selectedX = new Int16Array(total);
  const selectedY = new Int16Array(total);
  const used = new Uint8Array(total);
  const rank = new Float32Array(total);
  const candidatesPerStep = 12;

  for (let step = 0; step < total; step++) {
    let bestX = 0;
    let bestY = 0;
    let bestMinDistSq = -1;
    for (let c = 0; c < candidatesPerStep; c++) {
      const [cx, cy] = candidateXY(step, c, size);
      const idx = cy * size + cx;
      if (used[idx]) continue;

      let minDistSq = Number.POSITIVE_INFINITY;
      if (step === 0) {
        minDistSq = size * size;
      } else {
        for (let i = 0; i < step; i++) {
          const d2 = toroidalDistanceSq(cx, cy, selectedX[i], selectedY[i], size);
          if (d2 < minDistSq) minDistSq = d2;
          if (minDistSq <= bestMinDistSq) break;
        }
      }
      if (minDistSq > bestMinDistSq) {
        bestMinDistSq = minDistSq;
        bestX = cx;
        bestY = cy;
      }
    }

    const bestIdx = bestY * size + bestX;
    used[bestIdx] = 1;
    selectedX[step] = bestX;
    selectedY[step] = bestY;
    rank[bestIdx] = step / Math.max(1, total - 1);
  }

  return rank;
}

function blueNoiseThreshold(gx: number, gy: number): number {
  if (!blueNoiseTile) blueNoiseTile = buildBlueNoiseTile(BLUE_NOISE_SIZE);
  const size = BLUE_NOISE_SIZE;
  const x = ((gx % size) + size) % size;
  const y = ((gy % size) + size) % size;
  return blueNoiseTile[y * size + x];
}

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
    const threshold = blueNoiseThreshold(gx, gy);
    if (coverage <= threshold) return;
    // Slight radius variation with coverage keeps very light/heavy tones distinguishable
    // even though placement (not size) is the primary carrier of tone in FM screening.
    const r = radius * (0.72 + 0.28 * coverage);
    dots.push({ x: px, y: py, radius: r, shape });
  });
  return dots;
}
