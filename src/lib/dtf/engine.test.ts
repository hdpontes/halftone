/**
 * Testes do PrintLayerSet integrado (PASSO 6C/6D).
 * Executar com: npx tsx src/lib/dtf/engine.test.ts
 */
import { buildPrintLayerSet, DEFAULT_PRINT_ENGINE_SETTINGS } from "./engine";
import type { PrintEngineSettings, WhiteLayer } from "./types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function solidImage(width: number, height: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/** Sum of "ink presence" for a WhiteLayer regardless of mode (dots count, or non-zero coverage cells). */
function whiteInkAmount(white: WhiteLayer): number {
  if (white.mode === "halftone") return white.dots?.length ?? 0;
  if (white.mode === "solid") return white.coverage ? white.coverage.data.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0) : 0;
  return 0;
}

const sameChannel = (a: { x: number; y: number; radius: number }[], b: typeof a) =>
  a.length === b.length && a.every((d, i) => d.x === b[i].x && d.y === b[i].y && d.radius === b[i].radius);

const settings: PrintEngineSettings = DEFAULT_PRINT_ENGINE_SETTINGS; // white.whiteMode = "halftone" by default

// ---------------------------------------------------------------------------
// Teste 1 — PrintLayerSet: todas as camadas existem numa imagem conhecida.
// ---------------------------------------------------------------------------
{
  const w = 100,
    h = 100;
  const data = solidImage(w, h, 200, 60, 60, 255); // vermelho opaco
  const layers = buildPrintLayerSet(data, w, h, settings);
  check("PrintLayerSet: cyan existe", Array.isArray(layers.cyan));
  check("PrintLayerSet: magenta existe", Array.isArray(layers.magenta));
  check("PrintLayerSet: yellow existe", Array.isArray(layers.yellow));
  check("PrintLayerSet: black existe", Array.isArray(layers.black));
  check("PrintLayerSet: white existe", typeof layers.white === "object" && layers.white !== null);
  check("PrintLayerSet: alpha existe", layers.alpha instanceof Float32Array);
  check("PrintLayerSet: white é gerado (arte opaca)", whiteInkAmount(layers.white) > 0);
}

// ---------------------------------------------------------------------------
// Teste 2 — White independente: arte colorida opaca sem transparência ainda gera White.
// ---------------------------------------------------------------------------
{
  const w = 80,
    h = 80;
  const data = solidImage(w, h, 10, 200, 30, 255); // verde opaco, sem transparência
  const layers = buildPrintLayerSet(data, w, h, settings);
  check("White independente: gerado a partir do alpha (arte opaca), não de K", whiteInkAmount(layers.white) > 0);
}

// ---------------------------------------------------------------------------
// Teste 3 — K não vira White: área preta produz K>0 e White vem só do Underbase.
// ---------------------------------------------------------------------------
{
  const w = 80,
    h = 80;
  const black = solidImage(w, h, 0, 0, 0, 255);
  const layersBlack = buildPrintLayerSet(black, w, h, settings);
  check("K não vira White: preto -> black.length > 0", layersBlack.black.length > 0);

  const noWhiteSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "none" } };
  const layersNoWhite = buildPrintLayerSet(black, w, h, noWhiteSettings);
  check(
    "K não vira White: whiteMode=none -> white ausente mesmo com K>0",
    layersNoWhite.white.mode === "none" && whiteInkAmount(layersNoWhite.white) === 0 && layersNoWhite.black.length > 0
  );
}

// ---------------------------------------------------------------------------
// Teste 4 — canal independente: RGB=(255,0,0) puro -> M/Y presentes, C ausente/baixo.
// ---------------------------------------------------------------------------
{
  const w = 80,
    h = 80;
  const red = solidImage(w, h, 255, 0, 0, 255);
  const layers = buildPrintLayerSet(red, w, h, settings);
  check("canal independente: vermelho puro -> magenta presente", layers.magenta.length > 0);
  check("canal independente: vermelho puro -> yellow presente", layers.yellow.length > 0);
  check("canal independente: vermelho puro -> cyan ausente/baixo (c0=1-r=0)", layers.cyan.length === 0);
}

// ---------------------------------------------------------------------------
// Teste 5 — Alpha: 0 / 0.5 / 1, independente, sem double-alpha.
// ---------------------------------------------------------------------------
{
  const w = 40,
    h = 40;
  for (const a of [0, 128, 255]) {
    const data = solidImage(w, h, 180, 90, 40, a);
    const layers = buildPrintLayerSet(data, w, h, settings);
    const expectedAlpha = a / 255;
    check(`alpha=${a}: layers.alpha preserva o valor original (0..1)`, Math.abs(layers.alpha[0] - expectedAlpha) < 1e-6);
  }
  const dataTransparent = solidImage(w, h, 180, 90, 40, 0);
  const layersTransparent = buildPrintLayerSet(dataTransparent, w, h, settings);
  check(
    "alpha=0 -> nenhum dot de tinta é gerado, White ausente/zero (nenhum double-alpha residual)",
    layersTransparent.cyan.length + layersTransparent.magenta.length + layersTransparent.yellow.length + layersTransparent.black.length === 0 &&
      whiteInkAmount(layersTransparent.white) === 0
  );
  const dataOpaque = solidImage(w, h, 180, 90, 40, 255);
  const layersOpaque = buildPrintLayerSet(dataOpaque, w, h, settings);
  check("alpha=1 -> White conforme configuração (presente)", whiteInkAmount(layersOpaque.white) > 0);
}

// ---------------------------------------------------------------------------
// Teste 6 — dimensão.
// ---------------------------------------------------------------------------
{
  const w = 137,
    h = 91;
  const data = solidImage(w, h, 50, 50, 50, 255);
  const layers = buildPrintLayerSet(data, w, h, settings);
  check("dimensão: layers.width === image.width", layers.width === w);
  check("dimensão: layers.height === image.height", layers.height === h);
}

// ---------------------------------------------------------------------------
// Teste 7 — determinismo.
// ---------------------------------------------------------------------------
{
  const w = 60,
    h = 60;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 3) % 256;
    data[i * 4 + 1] = (i * 7) % 256;
    data[i * 4 + 2] = (i * 11) % 256;
    data[i * 4 + 3] = 255;
  }
  const run1 = buildPrintLayerSet(data, w, h, settings);
  const run2 = buildPrintLayerSet(data, w, h, settings);
  check("determinismo: cyan idêntico entre execuções", sameChannel(run1.cyan, run2.cyan));
  check("determinismo: white(halftone) idêntico entre execuções", sameChannel(run1.white.dots ?? [], run2.white.dots ?? []));
}

// ---------------------------------------------------------------------------
// Teste 8 — White solid: contrato correto (coverage presente, dots ausente).
// ---------------------------------------------------------------------------
{
  const w = 90,
    h = 90;
  const data = solidImage(w, h, 220, 40, 40, 255);
  const solidSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid" } };
  const layers = buildPrintLayerSet(data, w, h, solidSettings);
  check("White solid: mode === 'solid'", layers.white.mode === "solid");
  check("White solid: coverage !== undefined", layers.white.coverage !== undefined);
  check("White solid: dots === undefined", layers.white.dots === undefined);
  check("White solid: coverage tem valores > 0 (arte opaca)", (layers.white.coverage?.data.some((v) => v > 0)) ?? false);
}

// ---------------------------------------------------------------------------
// Teste 9 — White halftone: contrato correto (dots presente).
// ---------------------------------------------------------------------------
{
  const w = 90,
    h = 90;
  const data = solidImage(w, h, 220, 40, 40, 255);
  const halftoneSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "halftone" } };
  const layers = buildPrintLayerSet(data, w, h, halftoneSettings);
  check("White halftone: mode === 'halftone'", layers.white.mode === "halftone");
  check("White halftone: dots !== undefined", layers.white.dots !== undefined);
  check("White halftone: dots.length > 0 (arte opaca)", (layers.white.dots?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Teste 10 — White independence: variar whiteMode não altera CMYK.
// ---------------------------------------------------------------------------
{
  const w = 90,
    h = 90;
  const data = solidImage(w, h, 90, 160, 210, 255);
  const solidSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid" } };
  const halftoneSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "halftone" } };
  const noneSettings: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "none" } };
  const lSolid = buildPrintLayerSet(data, w, h, solidSettings);
  const lHalftone = buildPrintLayerSet(data, w, h, halftoneSettings);
  const lNone = buildPrintLayerSet(data, w, h, noneSettings);
  check("White independence: cyan igual entre solid/halftone/none", sameChannel(lSolid.cyan, lHalftone.cyan) && sameChannel(lHalftone.cyan, lNone.cyan));
  check("White independence: magenta igual entre solid/halftone/none", sameChannel(lSolid.magenta, lHalftone.magenta) && sameChannel(lHalftone.magenta, lNone.magenta));
  check("White independence: yellow igual entre solid/halftone/none", sameChannel(lSolid.yellow, lHalftone.yellow) && sameChannel(lHalftone.yellow, lNone.yellow));
  check("White independence: black igual entre solid/halftone/none", sameChannel(lSolid.black, lHalftone.black) && sameChannel(lHalftone.black, lNone.black));
}

// ---------------------------------------------------------------------------
// Teste 11 — Choke: continua sendo aplicado antes do White final (área diminui com choke maior).
// ---------------------------------------------------------------------------
{
  const w = 200,
    h = 200;
  const data = solidImage(w, h, 200, 50, 50, 255);
  const noChoke: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteChoke: 0 } };
  const bigChoke: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteChoke: 15 } };
  const lNo = buildPrintLayerSet(data, w, h, noChoke);
  const lBig = buildPrintLayerSet(data, w, h, bigChoke);
  const areaOf = (white: WhiteLayer) => (white.coverage ? white.coverage.data.reduce((s, v) => s + v, 0) : 0);
  check("choke: whiteChoke maior -> área de white menor", areaOf(lBig.white) < areaOf(lNo.white));
}

// ---------------------------------------------------------------------------
// Teste 12 — Density: whiteDensity altera cobertura do White sem alterar C/M/Y/K.
// ---------------------------------------------------------------------------
{
  const w = 90,
    h = 90;
  const data = solidImage(w, h, 90, 160, 210, 255);
  const lowDensity: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteDensity: 0.2 } };
  const highDensity: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteDensity: 1.0 } };
  const lLow = buildPrintLayerSet(data, w, h, lowDensity);
  const lHigh = buildPrintLayerSet(data, w, h, highDensity);
  const avgCov = (white: WhiteLayer) => (white.coverage ? white.coverage.data.reduce((s, v) => s + v, 0) / white.coverage.data.length : 0);
  check("density: whiteDensity maior -> cobertura média maior", avgCov(lHigh.white) > avgCov(lLow.white));
  check("density: CMYK inalterado entre whiteDensity diferentes", sameChannel(lLow.cyan, lHigh.cyan) && sameChannel(lLow.black, lHigh.black));
}

// ---------------------------------------------------------------------------
// Teste 13 — Gamma: whiteGamma altera resposta tonal do White sem alterar CMYK.
// ---------------------------------------------------------------------------
{
  const w = 90,
    h = 90;
  const data = solidImage(w, h, 90, 160, 210, 255);
  const lowGamma: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteGamma: 0.5 } };
  const highGamma: PrintEngineSettings = { ...settings, white: { ...settings.white, whiteMode: "solid", whiteGamma: 2.5 } };
  const lLow = buildPrintLayerSet(data, w, h, lowGamma);
  const lHigh = buildPrintLayerSet(data, w, h, highGamma);
  const avgCov = (white: WhiteLayer) => (white.coverage ? white.coverage.data.reduce((s, v) => s + v, 0) / white.coverage.data.length : 0);
  check("gamma: whiteGamma diferente -> cobertura média diferente", Math.abs(avgCov(lLow.white) - avgCov(lHigh.white)) > 1e-6);
  check("gamma: CMYK inalterado entre whiteGamma diferentes", sameChannel(lLow.magenta, lHigh.magenta) && sameChannel(lLow.yellow, lHigh.yellow));
}

console.log(`\n${passed} testes passaram.`);
