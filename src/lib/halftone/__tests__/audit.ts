// Halftone Test Lab (PASSO 3): numeric/statistical audit of the pure (canvas-free)
// engine core. Not a pass/fail suite — prints measured data for human review.
// Run: npm run audit:halftone
import { generateAmDots } from "../am";
import { generateFmDots } from "../fm";
import { generateHybridDots } from "../hybrid";
import { buildCoverageGridFromAlpha, chokeCoverageGrid } from "../choke";
import { buildWhiteUnderbase } from "../white";
import { runHalftoneEngine } from "../engine";
import { cellHash } from "../sampling";
import type { HalftoneSettings } from "../types";
import { MAX_RADIUS_FACTOR } from "../constants";

function base(overrides: Partial<HalftoneSettings> = {}): HalftoneSettings {
  return {
    dpi: 300,
    lpi: 45,
    angle: 22.5,
    algorithm: "am",
    dotShape: "round",
    colorMode: "rgb",
    gamma: 1.8,
    blackPoint: 16,
    whitePoint: 110,
    dotGain: 0,
    gain: 1,
    minDot: 0.015,
    maxDot: 1,
    hybridThreshold: 0.35,
    hybridBlendWidth: 0.1,
    whiteMode: "none",
    whiteDensity: 1,
    whiteChoke: 2,
    whiteLpi: 45,
    whiteAngle: 67.5,
    whiteDotShape: "round",
    whiteAlgorithm: "am",
    whiteGamma: 1,
    dustRemoval: false,
    cleanupMinDotPx: 1,
    previewQuality: "full",
    ...overrides,
  };
}

function section(title: string) {
  console.log("\n=== " + title + " ===");
}

// ---------------------------------------------------------------------------
section("1. AM — raio vs coverage (cellPx=300/45)");
// ---------------------------------------------------------------------------
{
  const cellPx = 300 / 45;
  const maxRadius = cellPx * MAX_RADIUS_FACTOR;
  for (const coverage of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
    const dots = generateAmDots(() => coverage, 40, 40, cellPx, 0, "round", { minDot: 0.015, maxDot: 1 });
    const r = dots.length ? dots[0].radius : 0;
    const areaFrac = (r * r) / (maxRadius * maxRadius);
    console.log(`coverage=${coverage.toFixed(2)}  radius=${r.toFixed(3)}px  r/maxR=${(r / maxRadius).toFixed(3)}  area/maxArea=${areaFrac.toFixed(3)}  dots=${dots.length}`);
  }
}

// ---------------------------------------------------------------------------
section("2. AM — overlap geométrico por forma (coverage=1.0)");
// ---------------------------------------------------------------------------
{
  const cellPx = 20;
  const maxRadius = cellPx * MAX_RADIUS_FACTOR;
  // Geometric area formulas mirrored from dots.ts drawShape (kept in sync manually for audit).
  const shapeArea: Record<string, (r: number) => number> = {
    round: (r) => Math.PI * r * r,
    square: (r) => Math.pow(r * 1.772, 2),
    diamond: (r) => Math.pow(r * 1.772, 2),
    ellipse: (r) => Math.PI * (r * 1.35) * (r * 0.72),
    line: (r) => cellPx * Math.max(0.4, Math.min(1, (r / maxRadius) ** 2)), // fixed formula: linear in coverage
    rosette: (r) => 4 * Math.PI * Math.pow(r * 0.5, 2),
  };
  const circleAreaAtMax = Math.PI * maxRadius * maxRadius;
  for (const shape of Object.keys(shapeArea)) {
    const areaAtMax = shapeArea[shape](maxRadius);
    const areaAtHalfCov = shapeArea[shape](maxRadius * Math.sqrt(0.5));
    console.log(
      `${shape.padEnd(8)} area@cov=1.0: ${areaAtMax.toFixed(1)}px² (${((areaAtMax / circleAreaAtMax) * 100).toFixed(0)}% of round)  ` +
        `area@cov=0.5: ${areaAtHalfCov.toFixed(1)}px² (expected ~50% of area@1.0 -> actual ${((areaAtHalfCov / areaAtMax) * 100).toFixed(0)}%)`
    );
  }
  console.log(`cell pitch=${cellPx}px, round diameter@cov=1.0=${(2 * maxRadius).toFixed(1)}px (${((2 * maxRadius) / cellPx) * 100 | 0}% of pitch)`);
}

// ---------------------------------------------------------------------------
section("3. FM — densidade de pontos vs coverage + estatística espacial");
// ---------------------------------------------------------------------------
{
  const w = 300,
    h = 300;
  for (const coverage of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const dots = generateFmDots(() => coverage, w, h, 0, "round", { minDot: 0, maxDot: 1 });
    const density = dots.length / (w * h);
    console.log(`coverage=${coverage.toFixed(2)}  dots=${dots.length}  density=${density.toFixed(5)}/px²`);
  }
  // Periodicity probe: row-wise dot counts over a flat 50% field — look for a repeating period.
  const dots = generateFmDots(() => 0.5, 512, 64, 0, "round", { minDot: 0, maxDot: 1 });
  const rowCounts = new Array(64).fill(0);
  for (const d of dots) rowCounts[Math.round(d.y)] = (rowCounts[Math.round(d.y)] || 0) + 1;
  const mean = rowCounts.reduce((a, b) => a + b, 0) / rowCounts.length;
  const variance = rowCounts.reduce((s, v) => s + (v - mean) ** 2, 0) / rowCounts.length;
  console.log(`linha->contagem: média=${mean.toFixed(2)} variância=${variance.toFixed(2)} (alta variância relativa à média indica textura/bandas nas linhas)`);
}

// ---------------------------------------------------------------------------
section("4. Hybrid — transição FM->AM ao redor de hybridThreshold x hybridBlendWidth");
// ---------------------------------------------------------------------------
{
  const w = 400,
    h = 20;
  for (const threshold of [0.25, 0.5, 0.75]) {
    for (const blendWidth of [0.05, 0.1, 0.15]) {
      // horizontal gradient 0..1
      const sample = (px: number) => px / w;
      const dots = generateHybridDots(sample, w, h, 300 / 45, 0, "round", {
        minDot: 0.015,
        maxDot: 1,
        hybridThreshold: threshold,
        hybridBlendWidth: blendWidth,
      });
      const below = dots.filter((d) => d.x / w < threshold - blendWidth / 2).length;
      const at = dots.filter((d) => Math.abs(d.x / w - threshold) < blendWidth / 2).length;
      const above = dots.filter((d) => d.x / w > threshold + blendWidth / 2).length;
      console.log(
        `threshold=${threshold} blendWidth=${blendWidth}  dots(<banda)=${below}  dots(dentro da banda)=${at}  dots(>banda)=${above}  total=${dots.length}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
section("5. Choke — área remanescente vs chokePx em diferentes resoluções");
// ---------------------------------------------------------------------------
{
  for (const size of [80, 500, 2000]) {
    const alpha = new Uint8ClampedArray(size * size).fill(255);
    for (const chokePx of [0, 1, 2, 3, 4, 6, 8, 10]) {
      const grid = buildCoverageGridFromAlpha(alpha, size, size, Math.min(4, Math.max(2, Math.round(size / 3000))));
      const choked = chokeCoverageGrid(grid, chokePx);
      const before = grid.data.reduce((s, v) => s + v, 0);
      const after = choked.data.reduce((s, v) => s + v, 0);
      console.log(`size=${size.toString().padStart(4)} chokePx=${chokePx.toString().padStart(2)} cellPx=${grid.cellPx} areaRatio=${(after / before).toFixed(3)}`);
    }
  }
}

// ---------------------------------------------------------------------------
section("6. Choke em detalhe pequeno (2px) com choke=4px");
// ---------------------------------------------------------------------------
{
  const size = 60;
  const alpha = new Uint8ClampedArray(size * size).fill(0);
  // 2px-wide vertical strip in the center.
  for (let y = 0; y < size; y++) {
    alpha[y * size + 29] = 255;
    alpha[y * size + 30] = 255;
  }
  const grid = buildCoverageGridFromAlpha(alpha, size, size, 2);
  const before = grid.data.reduce((s, v) => s + v, 0);
  for (const chokePx of [0, 1, 2, 4]) {
    const choked = chokeCoverageGrid(grid, chokePx);
    const after = choked.data.reduce((s, v) => s + v, 0);
    console.log(`detalhe 2px, chokePx=${chokePx}: área restante=${after.toFixed(2)} (original=${before.toFixed(2)}) -> ${after < 0.05 ? "DESAPARECEU" : "sobrevive"}`);
  }
}

// ---------------------------------------------------------------------------
section("7. White density (linearidade)");
// ---------------------------------------------------------------------------
{
  const size = 100;
  const alpha = new Uint8ClampedArray(size * size).fill(255);
  for (const density of [0, 0.25, 0.5, 0.75, 1.0]) {
    const settings = base({ whiteMode: "solid", whiteDensity: density, whiteChoke: 0 });
    const result = buildWhiteUnderbase(alpha, size, size, settings);
    const avg = result.solidCoverage!.data.reduce((s, v) => s + v, 0) / result.solidCoverage!.data.length;
    console.log(`whiteDensity=${density.toFixed(2)}  coberturaMedia=${avg.toFixed(3)}`);
  }
}

// ---------------------------------------------------------------------------
section("8. White gamma (curva)");
// ---------------------------------------------------------------------------
{
  const size = 100;
  const alpha = new Uint8ClampedArray(size * size).fill(180); // ~70% partial silhouette value (>8 threshold => still full 1 in binary mask)
  for (const g of [0.5, 1.0, 1.5, 2.0]) {
    const settings = base({ whiteMode: "solid", whiteDensity: 1, whiteChoke: 0, whiteGamma: g });
    const result = buildWhiteUnderbase(alpha, size, size, settings);
    const avg = result.solidCoverage!.data.reduce((s, v) => s + v, 0) / result.solidCoverage!.data.length;
    console.log(`whiteGamma=${g.toFixed(2)}  coberturaMedia=${avg.toFixed(3)} (mask binária de origem torna isso pouco sensível — ver nota no relatório)`);
  }
}

// ---------------------------------------------------------------------------
section("9. Alpha parcial vs whiteDensity — independência");
// ---------------------------------------------------------------------------
{
  const size = 40;
  const alphaHalf = new Uint8ClampedArray(size * size).fill(128); // ~50% alpha
  const alphaFull = new Uint8ClampedArray(size * size).fill(255);
  const s1 = base({ whiteMode: "solid", whiteDensity: 1.0, whiteChoke: 0 });
  const s2 = base({ whiteMode: "solid", whiteDensity: 0.5, whiteChoke: 0 });
  const r1 = buildWhiteUnderbase(alphaHalf, size, size, s1); // alpha=50%, density=100%
  const r2 = buildWhiteUnderbase(alphaFull, size, size, s2); // alpha=100%, density=50%
  const a1 = r1.solidCoverage!.data.reduce((s, v) => s + v, 0) / r1.solidCoverage!.data.length;
  const a2 = r2.solidCoverage!.data.reduce((s, v) => s + v, 0) / r2.solidCoverage!.data.length;
  console.log(`alpha=50% + density=100% -> coberturaMedia=${a1.toFixed(3)}`);
  console.log(`alpha=100% + density=50% -> coberturaMedia=${a2.toFixed(3)}`);
  console.log(a1 !== a2 ? "OK: resultados diferentes (alpha não é binarizado/copiado como densidade)" : "ATENÇÃO: resultados idênticos");
}

// ---------------------------------------------------------------------------
section("10. cellHash — distribuição/periodicidade");
// ---------------------------------------------------------------------------
{
  const N = 2000;
  const buckets = new Array(10).fill(0);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < 10; y++) {
      buckets[Math.min(9, Math.floor(cellHash(x, y) * 10))]++;
    }
  }
  console.log("distribuição por decil (deveria ser ~uniforme, ~2000 cada):", buckets.join(", "));
  // Autocorrelation-ish probe along x for fixed y.
  const seq = Array.from({ length: 64 }, (_, x) => cellHash(x, 0));
  let repeatPeriod = -1;
  for (let p = 1; p < 32; p++) {
    let match = true;
    for (let i = 0; i < 16; i++) if (Math.abs(seq[i] - seq[i + p]) > 1e-9) { match = false; break; }
    if (match) { repeatPeriod = p; break; }
  }
  console.log("período de repetição exata detectado em 64 amostras (x, y=0):", repeatPeriod === -1 ? "nenhum (<32)" : repeatPeriod);
}

// ---------------------------------------------------------------------------
section("11. Performance (runHalftoneEngine, algorithm=am)");
// ---------------------------------------------------------------------------
{
  for (const size of [500, 1000, 2000, 3000, 4000]) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = 120;
      data[i * 4 + 1] = 120;
      data[i * 4 + 2] = 120;
      data[i * 4 + 3] = 255;
    }
    const settings = base({ whiteMode: "halftone" });
    const t0 = performance.now();
    const layers = runHalftoneEngine(data, size, size, settings);
    const t1 = performance.now();
    const mem = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`size=${size}x${size}  tempo=${(t1 - t0).toFixed(1)}ms  colorDots=${layers.colorDots.length}  whiteDots=${layers.whiteDots?.length ?? 0}  heapUsed=${mem.toFixed(1)}MB`);
  }
}

// ---------------------------------------------------------------------------
section("12. Performance — choke EDT isolado em 4000px (PASSO 4)");
// ---------------------------------------------------------------------------
{
  const size = 4000;
  const alpha = new Uint8ClampedArray(size * size).fill(255);
  const downsample = Math.min(4, Math.max(2, Math.round(size / 3000)));
  const t0 = performance.now();
  const grid = buildCoverageGridFromAlpha(alpha, size, size, downsample);
  const t1 = performance.now();
  const choked = chokeCoverageGrid(grid, 6);
  const t2 = performance.now();
  const area = choked.data.reduce((s, v) => s + v, 0);
  const mem = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(
    `size=${size}x${size} downsample=${downsample} gridBuild=${(t1 - t0).toFixed(1)}ms choke(EDT)=${(t2 - t1).toFixed(1)}ms areaRestante=${area.toFixed(0)} heapUsed=${mem.toFixed(1)}MB`
  );
}

// ---------------------------------------------------------------------------
section("13. HYBRID GRADIENT — inspeção textural ao redor do threshold");
// ---------------------------------------------------------------------------
{
  // Amostra AM puro, FM puro e HYBRID sobre o mesmo gradiente 0..1 e compara a
  // densidade local (contagem de pontos por faixa de coverage) na vizinhança do
  // threshold, para verificar se a transição ficou suave (sem salto abrupto de
  // textura) com o blend, em vez do corte binário anterior.
  const w = 400,
    h = 20;
  const threshold = 0.5;
  const cellPx = 300 / 45;
  for (const blendWidth of [0, 0.1]) {
    const sample = (px: number) => px / w;
    const amDots = generateAmDots(sample, w, h, cellPx, 0, "round", { minDot: 0.015, maxDot: 1 });
    const fmDots = generateFmDots(sample, w, h, 0, "round", { minDot: 0.015, maxDot: 1 });
    const hybridDots = generateHybridDots(sample, w, h, cellPx, 0, "round", {
      minDot: 0.015,
      maxDot: 1,
      hybridThreshold: threshold,
      hybridBlendWidth: blendWidth,
    });
    const band = (dots: { x: number }[], loFrac: number, hiFrac: number) =>
      dots.filter((d) => d.x / w >= loFrac && d.x / w < hiFrac).length;
    // compara densidade em 5 faixas estreitas ao redor do threshold (0.4..0.6)
    const edges = [0.4, 0.44, 0.48, 0.52, 0.56, 0.6];
    const hybridCounts = [];
    for (let i = 0; i < edges.length - 1; i++) hybridCounts.push(band(hybridDots, edges[i], edges[i + 1]));
    console.log(
      `blendWidth=${blendWidth}  AM total=${amDots.length} FM total=${fmDots.length} HYBRID total=${hybridDots.length}`
    );
    console.log(`  HYBRID contagem por faixa [0.40-0.44,...,0.56-0.60] ao redor do threshold=${threshold}: ${hybridCounts.join(", ")}`);
    // Salto relativo entre faixas adjacentes (quanto menor, mais suave a transição)
    let maxJump = 0;
    for (let i = 1; i < hybridCounts.length; i++) maxJump = Math.max(maxJump, Math.abs(hybridCounts[i] - hybridCounts[i - 1]));
    console.log(`  maior salto entre faixas adjacentes: ${maxJump} (blendWidth=0 tende a ter salto maior que blendWidth>0)`);
  }
}

// ---------------------------------------------------------------------------
section("14. CHOKE — formas (círculo/quadrado/texto) em 0/1/2/4/8px");
// ---------------------------------------------------------------------------
{
  const size = 200;
  function circleMask(radius: number) {
    const alpha = new Uint8ClampedArray(size * size).fill(0);
    const cx = size / 2,
      cy = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) alpha[y * size + x] = 255;
      }
    }
    return alpha;
  }
  function squareMask(halfSide: number) {
    const alpha = new Uint8ClampedArray(size * size).fill(0);
    const cx = size / 2,
      cy = size / 2;
    for (let y = cy - halfSide; y < cy + halfSide; y++) {
      for (let x = cx - halfSide; x < cx + halfSide; x++) {
        if (x >= 0 && x < size && y >= 0 && y < size) alpha[y * size + x] = 255;
      }
    }
    return alpha;
  }
  function textLikeMask() {
    // Simula traços finos de texto: barras horizontais estreitas espaçadas (serifas simuladas).
    const alpha = new Uint8ClampedArray(size * size).fill(0);
    for (let barIndex = 0; barIndex < 6; barIndex++) {
      const y0 = 30 + barIndex * 25;
      for (let y = y0; y < y0 + 3; y++) {
        for (let x = 40; x < 160; x++) alpha[y * size + x] = 255;
      }
    }
    return alpha;
  }
  const shapes: Array<[string, Uint8ClampedArray]> = [
    ["círculo r=60", circleMask(60)],
    ["quadrado lado=100", squareMask(50)],
    ["texto (barras finas 3px)", textLikeMask()],
  ];
  for (const [name, alpha] of shapes) {
    const grid = buildCoverageGridFromAlpha(alpha, size, size, 1);
    const before = grid.data.reduce((s, v) => s + v, 0);
    const results: string[] = [];
    for (const chokePx of [0, 1, 2, 4, 8]) {
      const choked = chokeCoverageGrid(grid, chokePx);
      const after = choked.data.reduce((s, v) => s + v, 0);
      results.push(`px=${chokePx}:${(after / before).toFixed(3)}`);
    }
    console.log(`${name.padEnd(28)} areaRatio ${results.join("  ")}`);
  }
}

console.log("\nAuditoria concluída.");
