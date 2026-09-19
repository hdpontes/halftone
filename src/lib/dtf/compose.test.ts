/**
 * Testes de composição visual (PASSO 6C, atualizado no 6F para o modelo subtrativo).
 * Aproximação visual apenas — não física. Executar com: npx tsx src/lib/dtf/compose.test.ts
 */
import { composePrintPreview } from "./compose";
import type { CoverageGrid, DotDescriptor } from "../halftone/types";
import type { PrintLayerSet } from "./types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function emptyLayers(width: number, height: number): PrintLayerSet {
  return {
    cyan: [],
    magenta: [],
    yellow: [],
    black: [],
    white: { mode: "none", width, height },
    alpha: new Float32Array(width * height).fill(1),
    width,
    height,
    dpi: 300,
  };
}

function solidWhiteGrid(width: number, height: number, cellPx: number, value: number): CoverageGrid {
  const gw = Math.ceil(width / cellPx);
  const gh = Math.ceil(height / cellPx);
  return { data: new Float32Array(gw * gh).fill(value), width: gw, height: gh, cellPx };
}

function pixelAt(buf: { data: Uint8ClampedArray; width: number }, x: number, y: number): [number, number, number, number] {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

function fullDot(w: number, h: number): DotDescriptor {
  // Um único dot redondo oversized cobrindo toda a tela — simula 100% de cobertura sem
  // depender do tiling de grade do am/fm/hybrid (mantidos intactos neste PASSO).
  return { x: w / 2, y: h / 2, radius: Math.max(w, h), shape: "round" };
}

function approx(a: number, b: number, tol = 6): boolean {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// Canais isolados aproximam as primárias/secundárias subtrativas puras.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const cx = 10,
    cy = 10;

  const cLayers = emptyLayers(w, h);
  cLayers.cyan = [fullDot(w, h)];
  const [cr, cg, cb, ca] = pixelAt(composePrintPreview(cLayers), cx, cy);
  check("Apenas C: RGB ≈ (0,255,255)", approx(cr, 0) && approx(cg, 255) && approx(cb, 255) && ca === 255);

  const mLayers = emptyLayers(w, h);
  mLayers.magenta = [fullDot(w, h)];
  const [mr, mg, mb] = pixelAt(composePrintPreview(mLayers), cx, cy);
  check("Apenas M: RGB ≈ (255,0,255)", approx(mr, 255) && approx(mg, 0) && approx(mb, 255));

  const yLayers = emptyLayers(w, h);
  yLayers.yellow = [fullDot(w, h)];
  const [yr, yg, yb] = pixelAt(composePrintPreview(yLayers), cx, cy);
  check("Apenas Y: RGB ≈ (255,255,0)", approx(yr, 255) && approx(yg, 255) && approx(yb, 0));

  const kLayers = emptyLayers(w, h);
  kLayers.black = [fullDot(w, h)];
  const [kr, kg, kb] = pixelAt(composePrintPreview(kLayers), cx, cy);
  check("Apenas K: RGB ≈ (0,0,0)", approx(kr, 0) && approx(kg, 0) && approx(kb, 0));

  const wLayers = emptyLayers(w, h);
  wLayers.white = { mode: "halftone", dots: [{ x: cx, y: cy, radius: 5, shape: "round" }], width: w, height: h };
  const [wr, wg, wb] = pixelAt(composePrintPreview(wLayers), cx, cy);
  check("White isolado: pixel branco", wr === 255 && wg === 255 && wb === 255);
}

// ---------------------------------------------------------------------------
// Teste de sobreposição (seção 15 do PASSO 6F) — combinação subtrativa de dois canais.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const cx = 10,
    cy = 10;

  const my = emptyLayers(w, h);
  my.magenta = [fullDot(w, h)];
  my.yellow = [fullDot(w, h)];
  const [myR, myG, myB] = pixelAt(composePrintPreview(my), cx, cy);
  check("M+Y ≈ VERMELHO", approx(myR, 255) && approx(myG, 0) && approx(myB, 0));

  const cy_ = emptyLayers(w, h);
  cy_.cyan = [fullDot(w, h)];
  cy_.yellow = [fullDot(w, h)];
  const [cyR, cyG, cyB] = pixelAt(composePrintPreview(cy_), cx, cy);
  check("C+Y ≈ VERDE", approx(cyR, 0) && approx(cyG, 255) && approx(cyB, 0));

  const cm = emptyLayers(w, h);
  cm.cyan = [fullDot(w, h)];
  cm.magenta = [fullDot(w, h)];
  const [cmR, cmG, cmB] = pixelAt(composePrintPreview(cm), cx, cy);
  check("C+M ≈ AZUL", approx(cmR, 0) && approx(cmG, 0) && approx(cmB, 255));

  const cmy = emptyLayers(w, h);
  cmy.cyan = [fullDot(w, h)];
  cmy.magenta = [fullDot(w, h)];
  cmy.yellow = [fullDot(w, h)];
  const [cmyR, cmyG, cmyB] = pixelAt(composePrintPreview(cmy), cx, cy);
  check("C+M+Y ≈ PRETO/ESCURO", cmyR <= 6 && cmyG <= 6 && cmyB <= 6);
}

// ---------------------------------------------------------------------------
// K progressivo reduz luminosidade sem alterar o hue de forma inesperada.
// ---------------------------------------------------------------------------
{
  const w = 40,
    h = 40;
  function luminance(layers: PrintLayerSet): number {
    // Fundo opaco branco para a comparação de luminância fazer sentido mesmo onde K=0 (transparente).
    const buf = composePrintPreview(layers, { background: [255, 255, 255, 255] });
    let sum = 0;
    for (let i = 0; i < w * h; i++) sum += (buf.data[i * 4] + buf.data[i * 4 + 1] + buf.data[i * 4 + 2]) / 3;
    return sum / (w * h);
  }
  const k0 = emptyLayers(w, h); // K=0 -> nenhum dot (referência de luminância "alta")
  const k50 = emptyLayers(w, h);
  k50.black = [{ x: w / 2, y: h / 2, radius: w / 2, shape: "round" }]; // cobre ~metade da área
  const k100 = emptyLayers(w, h);
  k100.black = [fullDot(w, h)];
  const lum0 = luminance(k0);
  const lum50 = luminance(k50);
  const lum100 = luminance(k100);
  check("K progressivo: luminosidade cai (K=0 > K=50% > K=100%)", lum0 > lum50 && lum50 > lum100);
}

// ---------------------------------------------------------------------------
// White: 0/50/100% sobre fundo transparente — aparece, não altera C/M/Y/K.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const none = emptyLayers(w, h);
  const half = emptyLayers(w, h);
  half.white = { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 0.5), width: w, height: h };
  const full = emptyLayers(w, h);
  full.white = { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 1), width: w, height: h };

  const [, , , aNone] = pixelAt(composePrintPreview(none), 10, 10);
  const [rHalf, gHalf, bHalf, aHalf] = pixelAt(composePrintPreview(half), 10, 10);
  const [rFull, gFull, bFull, aFull] = pixelAt(composePrintPreview(full), 10, 10);
  check("White=0: transparente", aNone === 0);
  check("White=50%: branco parcialmente opaco", rHalf === 255 && gHalf === 255 && bHalf === 255 && aHalf > 0 && aHalf < 255);
  check("White=100%: branco opaco", rFull === 255 && gFull === 255 && bFull === 255 && aFull === 255);

  const withInk = emptyLayers(w, h);
  withInk.white = { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 1), width: w, height: h };
  withInk.magenta = [fullDot(w, h)];
  const inkPixel = pixelAt(composePrintPreview(withInk), 10, 10);
  check("White não altera CMYK: magenta continua presente com White cheio", inkPixel[0] === 255 && inkPixel[2] === 255);
}

// ---------------------------------------------------------------------------
// Alpha: 0/0.25/0.5/0.75/1 -> transparência final monotônica, aplicada uma única vez.
// ---------------------------------------------------------------------------
{
  const w = 10,
    h = 10;
  const alphas = [0, 0.25, 0.5, 0.75, 1];
  const finalAlphas = alphas.map((a) => {
    const layers = emptyLayers(w, h);
    layers.black = [fullDot(w, h)];
    layers.alpha = new Float32Array(w * h).fill(a);
    return pixelAt(composePrintPreview(layers), 5, 5)[3];
  });
  check("Alpha=0 -> totalmente transparente", finalAlphas[0] === 0);
  check("Alpha=1 -> totalmente opaco", finalAlphas[4] === 255);
  check(
    "Alpha monotônico entre 0 e 1",
    finalAlphas.every((v, i) => i === 0 || v >= finalAlphas[i - 1])
  );
}

// ---------------------------------------------------------------------------
// Halftone visual: área visualmente coberta cresce com a cobertura solicitada.
// ---------------------------------------------------------------------------
{
  const w = 100,
    h = 100;
  function visualArea(coverage: number): number {
    const r = Math.sqrt((coverage * w * h) / Math.PI);
    const layers = emptyLayers(w, h);
    layers.black = [{ x: w / 2, y: h / 2, radius: r, shape: "round" }];
    const buf = composePrintPreview(layers);
    let count = 0;
    for (let i = 0; i < w * h; i++) if (buf.data[i * 4 + 3] > 0) count++;
    return count;
  }
  const a25 = visualArea(0.25);
  const a50 = visualArea(0.5);
  const a75 = visualArea(0.75);
  const a100 = visualArea(1.0);
  check("Halftone visual: 25% < 50% < 75% < 100%", a25 < a50 && a50 < a75 && a75 <= a100);
}

// ---------------------------------------------------------------------------
// Independência: mudar densidade de White não contamina a cor CMYK resultante.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const base = emptyLayers(w, h);
  base.cyan = [fullDot(w, h)];
  base.magenta = [fullDot(w, h)];
  base.yellow = [fullDot(w, h)];
  base.black = [fullDot(w, h)];

  const variantA: PrintLayerSet = { ...base, white: { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 0.3), width: w, height: h } };
  const variantB: PrintLayerSet = { ...base, white: { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 0.9), width: w, height: h } };
  const [rA, gA, bA] = pixelAt(composePrintPreview(variantA), 10, 10);
  const [rB, gB, bB] = pixelAt(composePrintPreview(variantB), 10, 10);
  check("Independência: mudar densidade de White não muda a cor CMYK resultante", rA === rB && gA === gB && bA === bB);
}

// ---------------------------------------------------------------------------
// Ordem: White fica abaixo das camadas de cor (ink opaco sobrepõe o White).
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const layers = emptyLayers(w, h);
  layers.white = { mode: "halftone", dots: [{ x: 10, y: 10, radius: 6, shape: "round" }], width: w, height: h };
  layers.cyan = [{ x: 10, y: 10, radius: 4, shape: "round" }];
  const buf = composePrintPreview(layers);
  const [r, g, b] = pixelAt(buf, 10, 10);
  check("Ordem: no centro (coberto por White e Cyan) prevalece a tinta (Cyan sobre White)", r === 0 && g === 255 && b === 255);
  const [rEdge, gEdge, bEdge] = pixelAt(buf, 15, 10); // dentro do raio do white (6) mas fora do cyan (4)
  check("Ordem: fora do raio da tinta mas dentro do White -> branco visível", rEdge === 255 && gEdge === 255 && bEdge === 255);
}

// ---------------------------------------------------------------------------
// Canal vazio: todas as camadas vazias -> preview transparente.
// ---------------------------------------------------------------------------
{
  const w = 15,
    h = 15;
  const layers = emptyLayers(w, h);
  const buf = composePrintPreview(layers);
  let allTransparent = true;
  for (let i = 0; i < w * h; i++) {
    if (buf.data[i * 4 + 3] !== 0) {
      allTransparent = false;
      break;
    }
  }
  check("canal vazio: preview totalmente transparente por padrão", allTransparent);
}

// ---------------------------------------------------------------------------
// White solid (isolado): rasteriza coverage diretamente, sem inventar dots.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const layers = emptyLayers(w, h);
  const grid = solidWhiteGrid(w, h, 2, 1); // cobertura total, cellPx=2
  layers.white = { mode: "solid", coverage: grid, width: w, height: h };
  const buf = composePrintPreview(layers);
  const [r, g, b, a] = pixelAt(buf, 10, 10);
  check("White solid: pixel dentro da cobertura fica branco opaco", r === 255 && g === 255 && b === 255 && a === 255);
}

// ---------------------------------------------------------------------------
// CMYK + White solid: White solid embaixo, cor por cima.
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const layers = emptyLayers(w, h);
  layers.white = { mode: "solid", coverage: solidWhiteGrid(w, h, 2, 1), width: w, height: h };
  layers.magenta = [{ x: 10, y: 10, radius: 4, shape: "round" }];
  const buf = composePrintPreview(layers);
  const [r, g, b] = pixelAt(buf, 10, 10);
  check("CMYK + White solid: centro coberto por magenta prevalece magenta", r === 255 && g === 0 && b === 255);
  const [rEdge, gEdge, bEdge] = pixelAt(buf, 18, 18); // fora do raio da magenta, dentro da cobertura solid
  check("CMYK + White solid: fora do raio de cor, branco continua visível", rEdge === 255 && gEdge === 255 && bEdge === 255);
}

// ---------------------------------------------------------------------------
// CMYK + White halftone: combinação válida (já é o caso comum, reforçado aqui).
// ---------------------------------------------------------------------------
{
  const w = 20,
    h = 20;
  const layers = emptyLayers(w, h);
  layers.white = { mode: "halftone", dots: [{ x: 10, y: 10, radius: 6, shape: "round" }], width: w, height: h };
  layers.black = [{ x: 10, y: 10, radius: 3, shape: "round" }];
  const buf = composePrintPreview(layers);
  const [r, g, b] = pixelAt(buf, 10, 10);
  check("CMYK + White halftone: centro coberto por black prevalece black", r === 0 && g === 0 && b === 0);
}

console.log(`\n${passed} testes passaram.`);

