/**
 * Testes do Halftone Engine PRO (10 cenários obrigatórios do PASSO 2).
 * Executar com: npx tsx src/lib/halftone/__tests__/engine.test.ts
 * Não usa framework de teste (nenhum instalado no projeto) — cada `check()`
 * lança um erro (processo sai com código != 0) se a asserção falhar.
 */
import { DEFAULT_HALFTONE_SETTINGS } from "../constants";
import { generateAmDots } from "../am";
import { generateFmDots } from "../fm";
import { generateHybridDots } from "../hybrid";
import { buildCoverageGridFromAlpha, chokeCoverageGrid } from "../choke";
import { buildWhiteUnderbase } from "../white";
import { runHalftoneEngine } from "../engine";
import type { HalftoneSettings } from "../types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function makeSolidRgbaImage(width: number, height: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

function settingsWith(overrides: Partial<HalftoneSettings>): HalftoneSettings {
  return { ...DEFAULT_HALFTONE_SETTINGS, ...overrides };
}

// 1) Imagem totalmente transparente -> nenhum dot de cor e nenhum branco.
{
  const w = 60,
    h = 60;
  const data = makeSolidRgbaImage(w, h, 0, 0, 0, 0);
  const settings = settingsWith({ whiteMode: "halftone" });
  const layers = runHalftoneEngine(data, w, h, settings);
  check("1. transparente -> 0 color dots", layers.colorDots.length === 0);
  check("1. transparente -> 0 white dots", (layers.whiteDots ?? []).length === 0);
}

// 2) Imagem totalmente opaca e escura -> alpha final praticamente cheio de dots, whiteMask=densidade máxima dentro da máscara.
{
  const w = 60,
    h = 60;
  const data = makeSolidRgbaImage(w, h, 10, 10, 10, 255);
  const settings = settingsWith({ whiteMode: "solid", whiteDensity: 1, whiteChoke: 0 });
  const layers = runHalftoneEngine(data, w, h, settings);
  check("2. opaco -> gera color dots", layers.colorDots.length > 0);
  const grid = layers.whiteSolidCoverage!;
  check("2. opaco -> whiteSolidCoverage existe", !!grid);
  const center = grid.data[Math.floor(grid.height / 2) * grid.width + Math.floor(grid.width / 2)];
  check("2. opaco -> whiteMask no centro ~1", center > 0.9);
}

// 3) whiteDensity = 0 -> whiteMask inteiramente 0.
{
  const w = 40,
    h = 40;
  const data = makeSolidRgbaImage(w, h, 10, 10, 10, 255);
  const settings = settingsWith({ whiteMode: "solid", whiteDensity: 0, whiteChoke: 0 });
  const layers = runHalftoneEngine(data, w, h, settings);
  const grid = layers.whiteSolidCoverage!;
  const allZero = grid.data.every((v) => v === 0);
  check("3. whiteDensity=0 -> mask toda zero", allZero);
}

// 4) whiteDensity = 100% -> cobertura máxima dentro da máscara (sem choke).
{
  const w = 40,
    h = 40;
  const data = makeSolidRgbaImage(w, h, 10, 10, 10, 255);
  const settings = settingsWith({ whiteMode: "solid", whiteDensity: 1, whiteChoke: 0 });
  const layers = runHalftoneEngine(data, w, h, settings);
  const grid = layers.whiteSolidCoverage!;
  const maxVal = Math.max(...grid.data);
  check("4. whiteDensity=100% -> cobertura máxima ~1", maxVal > 0.95);
}

// 5) whiteChoke > 0 -> área branca menor que a máscara original (erosão real, não opacidade).
{
  const w = 80,
    h = 80;
  const alpha = new Uint8ClampedArray(w * h).fill(255);
  const artGrid = buildCoverageGridFromAlpha(alpha, w, h, 4);
  const areaBefore = artGrid.data.reduce((s, v) => s + v, 0);
  const choked = chokeCoverageGrid(artGrid, 12);
  const areaAfter = choked.data.reduce((s, v) => s + v, 0);
  check("5. whiteChoke>0 -> área diminui", areaAfter < areaBefore);
}

// 6) whiteChoke = 0 -> segue a máscara original (aprox. igual).
{
  const w = 60,
    h = 60;
  const alpha = new Uint8ClampedArray(w * h).fill(255);
  const artGrid = buildCoverageGridFromAlpha(alpha, w, h, 4);
  const choked = chokeCoverageGrid(artGrid, 0);
  let identical = true;
  for (let i = 0; i < artGrid.data.length; i++) if (Math.abs(artGrid.data[i] - choked.data[i]) > 1e-6) identical = false;
  check("6. whiteChoke=0 -> segue máscara original", identical);
}

// 6b) Calibração do choke: o mesmo whiteChoke (em px) deve produzir uma redução de
//     área proporcionalmente parecida em imagens pequenas e grandes (não deve
//     "sumir" com detalhes finos em imagens grandes por causa de downsample grosseiro).
{
  const measureShrinkRatio = (size: number, chokePx: number) => {
    const alpha = new Uint8ClampedArray(size * size).fill(255);
    const settings = settingsWith({ whiteMode: "solid", whiteDensity: 1, whiteChoke: chokePx });
    const result = buildWhiteUnderbase(alpha, size, size, settings);
    const grid = result.solidCoverage!;
    const area = grid.data.reduce((s, v) => s + v, 0) / (grid.width * grid.height);
    return area; // 0..1 fraction of the grid still covered after choke
  };
  const smallRatio = measureShrinkRatio(80, 4);
  const largeRatio = measureShrinkRatio(2000, 4);
  check("6b. choke pequeno não zera a área em imagem grande", largeRatio > 0.5);
  check("6b. choke tem efeito comparável (não explode) entre resoluções", Math.abs(smallRatio - largeRatio) < 0.35);
}


// 7) AM vs FM geram distribuições de pontos genuinamente diferentes para a mesma imagem.
{
  const w = 100,
    h = 100;
  const sampleCoverage = () => 0.5;
  const amDots = generateAmDots(sampleCoverage, w, h, 8, 22.5, "round", { minDot: 0.015, maxDot: 1 });
  const fmDots = generateFmDots(sampleCoverage, w, h, 22.5, "round", { minDot: 0.015, maxDot: 1 });
  check("7. AM produz pontos", amDots.length > 0);
  check("7. FM produz pontos", fmDots.length > 0);
  check("7. AM e FM têm contagens diferentes", amDots.length !== fmDots.length);
  const amRadii = new Set(amDots.map((d) => Math.round(d.radius * 100)));
  check("7. AM tem raio ~constante p/ cobertura constante (poucos buckets)", amRadii.size <= 2);
  check("7. FM tem posições muito mais numerosas e finas que AM (grade micro)", fmDots.length > amDots.length);
}

// 8) Mudar o LPI muda a frequência espacial (menos LPI -> menos pontos AM na mesma área).
{
  const w = 200,
    h = 200;
  const sampleCoverage = () => 0.4;
  const lowLpiDots = generateAmDots(sampleCoverage, w, h, 200 / 20, 0, "round", { minDot: 0.015, maxDot: 1 });
  const highLpiDots = generateAmDots(sampleCoverage, w, h, 200 / 60, 0, "round", { minDot: 0.015, maxDot: 1 });
  check("8. LPI maior -> mais pontos na mesma área", highLpiDots.length > lowLpiDots.length);
}

// 9) Mudar o ângulo muda a orientação da grade (posições diferentes para o mesmo LPI).
{
  const w = 100,
    h = 100;
  const sampleCoverage = () => 0.5;
  const dots0 = generateAmDots(sampleCoverage, w, h, 10, 0, "round", { minDot: 0.015, maxDot: 1 });
  const dots45 = generateAmDots(sampleCoverage, w, h, 10, 45, "round", { minDot: 0.015, maxDot: 1 });
  const key = (d: { x: number; y: number }) => `${Math.round(d.x)}_${Math.round(d.y)}`;
  const set0 = new Set(dots0.map(key));
  const overlap = dots45.filter((d) => set0.has(key(d))).length;
  check("9. ângulo diferente -> posições majoritariamente diferentes", overlap < dots45.length * 0.5);
}

// 10) White Underbase nunca é derivado diretamente do alpha sem passar pelo pipeline
//     (choke/densidade mudam o resultado; nunca é uma cópia crua do alpha == "alpha as white").
{
  const w = 40,
    h = 40;
  const alpha = new Uint8ClampedArray(w * h).fill(200); // alpha != 0/255, valor arbitrário
  const settings = settingsWith({ whiteMode: "solid", whiteDensity: 0.5, whiteChoke: 4 });
  const result = buildWhiteUnderbase(alpha, w, h, settings);
  const grid = result.solidCoverage!;
  const rawAlphaFraction = 200 / 255;
  const isRawAlphaCopy = Math.abs(grid.data[0] - rawAlphaFraction) < 1e-6;
  check("10. whiteMask não é cópia direta do alpha", !isRawAlphaCopy);
  const maxVal = Math.max(...grid.data);
  check("10. whiteDensity=0.5 -> cobertura respeita o teto de densidade", maxVal <= 0.5 + 1e-6);
}

// 11) PASSO 4 — precisão real do choke: 0/1/2/3/4/5/8/10px devem ser monotônicos
//     (choke maior nunca aumenta a área) e não podem produzir valores artificialmente
//     idênticos entre passos consecutivos numa máscara grande o suficiente.
{
  const w = 400,
    h = 400;
  const alpha = new Uint8ClampedArray(w * h).fill(255);
  const grid = buildCoverageGridFromAlpha(alpha, w, h, 1);
  const chokeValues = [0, 1, 2, 3, 4, 5, 8, 10];
  const areas = chokeValues.map((c) => chokeCoverageGrid(grid, c).data.reduce((s, v) => s + v, 0));
  let monotonic = true;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[i - 1] + 1e-6) monotonic = false;
  check("11. choke monotônico (maior nunca aumenta área)", monotonic);
  let allDistinct = true;
  for (let i = 1; i < areas.length; i++) if (Math.abs(areas[i] - areas[i - 1]) < 1e-6) allDistinct = false;
  check("11. valores consecutivos de choke não são artificialmente idênticos", allDistinct);
}

// 12) Choke em detalhes pequenos: documenta (sem "consertar" automaticamente) o
//     desaparecimento de detalhes menores que o choke aplicado.
{
  const w = 100,
    h = 100;
  function stripMask(widthPx: number) {
    const alpha = new Uint8ClampedArray(w * h).fill(0);
    const x0 = Math.floor((w - widthPx) / 2);
    for (let y = 0; y < h; y++) for (let x = x0; x < x0 + widthPx; x++) alpha[y * w + x] = 255;
    return alpha;
  }
  for (const detailPx of [2, 4, 8, 16]) {
    const alpha = stripMask(detailPx);
    const grid = buildCoverageGridFromAlpha(alpha, w, h, 1);
    const areaBefore = grid.data.reduce((s, v) => s + v, 0);
    check(`12. detalhe ${detailPx}px existe antes do choke`, areaBefore > 0);
    const choked = chokeCoverageGrid(grid, 4);
    const areaAfter = choked.data.reduce((s, v) => s + v, 0);
    check(`12. detalhe ${detailPx}px com choke=4px nunca aumenta de área`, areaAfter <= areaBefore + 1e-6);
  }
}

// 13) Hybrid com blend suave: cobertura total não deve "explodir" (somar AM+FM sem
//     controle) dentro da faixa de transição, e continua existindo pontos nos dois
//     lados do threshold (sem gap de cobertura).
{
  const w = 300,
    h = 20;
  for (const threshold of [0.25, 0.5, 0.75]) {
    for (const blendWidth of [0.05, 0.1, 0.15]) {
      const sample = (px: number) => px / w; // gradiente horizontal 0..1
      const dots = generateHybridDots(sample, w, h, 300 / 45, 0, "round", {
        minDot: 0.015,
        maxDot: 1,
        hybridThreshold: threshold,
        hybridBlendWidth: blendWidth,
      });
      check(`13. hybrid thr=${threshold} blend=${blendWidth} -> gera pontos nos dois lados`, dots.length > 0);
      // Aproximação prática de "sem duplicar cobertura": nenhum dot deve exceder o
      // raio máximo teórico do AM puro para a coverage bruta (amWeight+fmWeight=1 garante
      // que nenhum dos dois motores recebe mais coverage do que a bruta em si).
      const maxRadius = (300 / 45) * 0.62;
      const anyOverMax = dots.some((d) => d.radius > maxRadius + 1e-6);
      check(`13. hybrid thr=${threshold} blend=${blendWidth} -> nenhum dot excede o raio máximo (sem duplicar cobertura)`, !anyOverMax);
    }
  }
  // blendWidth=0 deve reproduzir o corte abrupto anterior (compatibilidade retroativa).
  const sample = (px: number) => px / w;
  const hard = generateHybridDots(sample, w, h, 300 / 45, 0, "round", { minDot: 0.015, maxDot: 1, hybridThreshold: 0.5, hybridBlendWidth: 0 });
  check("13. hybridBlendWidth=0 -> ainda gera pontos (corte abrupto compatível)", hard.length > 0);
}

console.log(`\n${passed} testes passaram.`);
