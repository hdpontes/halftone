/**
 * Testes do exportador DTF Pro CMYK (PASSO 7A). Executar com: npx tsx src/lib/dtf/export.test.ts
 * Cobre o fluxo principal (exportFinalDtfPng: PNG final único 300 DPI pronto para impressão) e
 * o exportador avançado/diagnóstico por canal (exportDtfLayers): dimensões, DPI (pHYs
 * round-trip), conteúdo por canal, White solid/halftone/none, Alpha exato, independência entre
 * canais, transparência (sem tinta = 0, nunca branco), alinhamento entre canais, bordas (dots em
 * x=0/width-1/y=0/height-1 não recortados), combinações CMYK e determinismo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { exportDtfLayers, exportFinalDtfPng, FINAL_DTF_DPI } from "./export";
import { decodePng } from "./png";
import type { DotDescriptor } from "../halftone/types";
import type { PrintLayerSet } from "./types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function emptyLayers(width: number, height: number, dpi = 300): PrintLayerSet {
  return {
    cyan: [],
    magenta: [],
    yellow: [],
    black: [],
    white: { mode: "none", width, height },
    alpha: new Float32Array(width * height).fill(1),
    width,
    height,
    dpi,
  };
}

function dotAt(x: number, y: number, radius = 3): DotDescriptor {
  return { x, y, radius, shape: "round" };
}

function findFile(files: { filename: string; bytes: Uint8Array }[], suffix: string) {
  return files.find((f) => f.filename.endsWith(suffix));
}

// 1) Dimensões: todos os arquivos compartilham width x height do PrintLayerSet, sem crop.
{
  const layers = emptyLayers(50, 30);
  layers.cyan = [dotAt(25, 15)];
  layers.white = { mode: "halftone", width: 50, height: 30, dots: [dotAt(10, 10)] };
  const { files } = exportDtfLayers(layers, { baseName: "t" });
  for (const f of files) {
    const decoded = decodePng(f.bytes);
    check(`dimensão correta em ${f.filename}`, decoded.width === 50 && decoded.height === 30);
  }
  check("gerou C, M, Y, K, W, Alpha, Preview", files.length === 7);
}

// 2) DPI: pHYs round-trip em 300/600/1200.
for (const dpi of [300, 600, 1200]) {
  const layers = emptyLayers(20, 20, dpi);
  const { files } = exportDtfLayers(layers, { baseName: "t", includeWhite: false, includePreview: false });
  for (const f of files) {
    const decoded = decodePng(f.bytes);
    check(`DPI ${dpi} preservado em ${f.filename}`, decoded.dpi === dpi);
  }
}

// 3) Conteúdo por canal: dot presente em C não aparece em M/Y/K.
{
  const layers = emptyLayers(40, 40);
  layers.cyan = [dotAt(20, 20, 5)];
  const { files } = exportDtfLayers(layers, { baseName: "t", includeWhite: false, includePreview: false });
  const c = decodePng(findFile(files, "_C.png")!.bytes);
  const m = decodePng(findFile(files, "_M.png")!.bytes);
  const y = decodePng(findFile(files, "_Y.png")!.bytes);
  const k = decodePng(findFile(files, "_K.png")!.bytes);
  check("C tem tinta no centro do dot", c.pixels[20 * 40 + 20] === 255);
  check("M permanece vazio (0)", m.pixels.every((v) => v === 0));
  check("Y permanece vazio (0)", y.pixels.every((v) => v === 0));
  check("K permanece vazio (0)", k.pixels.every((v) => v === 0));
}

// 4) White: solid (via coverage), halftone (via dots), none (arquivo omitido).
{
  const layers = emptyLayers(20, 10);
  layers.white = { mode: "solid", width: 20, height: 10, coverage: { data: new Float32Array(20 * 10).fill(0.5), width: 20, height: 10, cellPx: 1 } };
  const { files } = exportDtfLayers(layers, { baseName: "t", includeCyan: false, includeMagenta: false, includeYellow: false, includeBlack: false, includeAlpha: false, includePreview: false });
  const w = decodePng(findFile(files, "_W.png")!.bytes);
  check("White solid vira 128 (0.5 * 255 arredondado)", w.pixels[0] === 128);
}
{
  const layers = emptyLayers(20, 10);
  layers.white = { mode: "halftone", width: 20, height: 10, dots: [dotAt(5, 5, 3)] };
  const { files } = exportDtfLayers(layers, { baseName: "t", includeCyan: false, includeMagenta: false, includeYellow: false, includeBlack: false, includeAlpha: false, includePreview: false });
  const w = decodePng(findFile(files, "_W.png")!.bytes);
  check("White halftone tem tinta no dot", w.pixels[5 * 20 + 5] === 255);
}
{
  const layers = emptyLayers(20, 10); // white.mode === "none"
  const { files } = exportDtfLayers(layers, { baseName: "t", includeCyan: false, includeMagenta: false, includeYellow: false, includeBlack: false, includeAlpha: false, includePreview: false });
  check("White none: arquivo _W.png omitido", !findFile(files, "_W.png"));
}

// 5) Alpha: valores exatos preservados (0, 128/255≈0.502, 255).
{
  const layers = emptyLayers(3, 1);
  layers.alpha = new Float32Array([0, 0.5, 1]);
  const { files } = exportDtfLayers(layers, { baseName: "t", includeCyan: false, includeMagenta: false, includeYellow: false, includeBlack: false, includeWhite: false, includePreview: false });
  const a = decodePng(findFile(files, "_Alpha.png")!.bytes);
  check("Alpha 0 -> 0", a.pixels[0] === 0);
  check("Alpha 0.5 -> 128 (arredondado)", a.pixels[1] === 128);
  check("Alpha 1 -> 255", a.pixels[2] === 255);
}

// 6) Independência entre canais: alterar apenas C não muda M/Y/K/White/Alpha.
{
  const base = emptyLayers(30, 30);
  base.magenta = [dotAt(15, 15, 4)];
  base.white = { mode: "halftone", width: 30, height: 30, dots: [dotAt(3, 3, 2)] };
  const before = exportDtfLayers(base, { baseName: "t" });

  const changed: PrintLayerSet = { ...base, cyan: [dotAt(25, 25, 4)] };
  const after = exportDtfLayers(changed, { baseName: "t" });

  for (const suffix of ["_M.png", "_Y.png", "_K.png", "_W.png", "_Alpha.png"]) {
    const b = findFile(before.files, suffix)!.bytes;
    const a = findFile(after.files, suffix)!.bytes;
    check(`independência de canal: ${suffix} inalterado ao mudar C`, b.length === a.length && b.every((v, i) => v === a[i]));
  }
  const bC = findFile(before.files, "_C.png")!.bytes;
  const aC = findFile(after.files, "_C.png")!.bytes;
  check("C mudou de fato entre before/after", !(bC.length === aC.length && bC.every((v, i) => v === aC[i])));
}

// 7) Transparência: pixels sem tinta permanecem 0 (nunca "brancos").
{
  const layers = emptyLayers(10, 10);
  const { files } = exportDtfLayers(layers, { baseName: "t", includeWhite: false, includePreview: false });
  for (const suffix of ["_C.png", "_M.png", "_Y.png", "_K.png"]) {
    const decoded = decodePng(findFile(files, suffix)!.bytes);
    check(`${suffix} sem tinta fica em 0, não 255`, decoded.pixels.every((v) => v === 0));
  }
}

// 8) Alinhamento: dot em (x=100,y=200) aparece na mesma posição em C e em K.
{
  const layers = emptyLayers(256, 256);
  layers.cyan = [dotAt(100, 200, 4)];
  layers.black = [dotAt(100, 200, 4)];
  const { files } = exportDtfLayers(layers, { baseName: "t", includeWhite: false, includeAlpha: false, includePreview: false });
  const c = decodePng(findFile(files, "_C.png")!.bytes);
  const k = decodePng(findFile(files, "_K.png")!.bytes);
  const idx = 200 * 256 + 100;
  check("alinhamento: C tem tinta em (100,200)", c.pixels[idx] === 255);
  check("alinhamento: K tem tinta em (100,200)", k.pixels[idx] === 255);
}

// 9) Bordas: dots em x=0, x=width-1, y=0, y=height-1 não são recortados.
{
  const w = 50,
    h = 40;
  const layers = emptyLayers(w, h);
  layers.cyan = [dotAt(0, 0, 1), dotAt(w - 1, 0, 1), dotAt(0, h - 1, 1), dotAt(w - 1, h - 1, 1)];
  const { files } = exportDtfLayers(layers, { baseName: "t", includeWhite: false, includeAlpha: false, includePreview: false });
  const c = decodePng(findFile(files, "_C.png")!.bytes);
  check("borda x=0,y=0 presente", c.pixels[0 * w + 0] === 255);
  check("borda x=w-1,y=0 presente", c.pixels[0 * w + (w - 1)] === 255);
  check("borda x=0,y=h-1 presente", c.pixels[(h - 1) * w + 0] === 255);
  check("borda x=w-1,y=h-1 presente", c.pixels[(h - 1) * w + (w - 1)] === 255);
  check("dimensão não foi recortada (largura)", c.width === w);
  check("dimensão não foi recortada (altura)", c.height === h);
}

// 10) Determinismo: mesma entrada + opções produzem PNGs pixel-idênticos entre duas execuções.
{
  const layers = emptyLayers(64, 64);
  layers.cyan = [dotAt(30, 30, 6)];
  layers.white = { mode: "solid", width: 64, height: 64, coverage: { data: new Float32Array(64 * 64).fill(0.3), width: 64, height: 64, cellPx: 1 } };
  const run1 = exportDtfLayers(layers, { baseName: "t" });
  const run2 = exportDtfLayers(layers, { baseName: "t" });
  for (let i = 0; i < run1.files.length; i++) {
    const a = run1.files[i].bytes;
    const b = run2.files[i].bytes;
    check(`determinismo: ${run1.files[i].filename} idêntico entre execuções`, a.length === b.length && a.every((v, idx) => v === b[idx]));
  }
}

// ---------------------------------------------------------------------------------------
// exportFinalDtfPng — fluxo principal: PNG único "<nome>_DTF.png", 300 DPI, pronto p/ impressão.
// ---------------------------------------------------------------------------------------

function rgbaAt(decoded: { pixels: Uint8ClampedArray }, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [decoded.pixels[i], decoded.pixels[i + 1], decoded.pixels[i + 2], decoded.pixels[i + 3]];
}

// 11) Dimensões exatas (sem crop/resize) em três resoluções, incluindo não-quadrada.
for (const [w, h] of [
  [1000, 1000],
  [2000, 1500],
  [4000, 4000],
]) {
  const layers = emptyLayers(w, h);
  layers.cyan = [dotAt(Math.floor(w / 2), Math.floor(h / 2), 5)];
  const { filename, bytes } = exportFinalDtfPng(layers, "doc");
  const decoded = decodePng(bytes);
  check(`_DTF.png ${w}x${h}: dimensão exata, sem crop`, decoded.width === w && decoded.height === h);
  check(`_DTF.png ${w}x${h}: nome de arquivo`, filename === "doc_DTF.png");
}

// 12) DPI fixo em 300 via pHYs, independente do dpi do PrintLayerSet de origem.
for (const sourceDpi of [300, 600, 1200]) {
  const layers = emptyLayers(30, 30, sourceDpi);
  const { bytes } = exportFinalDtfPng(layers);
  const decoded = decodePng(bytes);
  check(`_DTF.png: pHYs sempre ${FINAL_DTF_DPI} DPI (origem ${sourceDpi})`, decoded.dpi === FINAL_DTF_DPI);
}

// 13) Alpha exato preservado no composto final (0, 128, 255), sem preencher fundo de branco.
// Usa um White "solid" opaco de base para que exista tinta nesses pixels — sem tinta, o
// pixel permanece transparente por definição (nada a imprimir ali), independente do alpha.
{
  const layers = emptyLayers(3, 1);
  layers.white = { mode: "solid", width: 3, height: 1, coverage: { data: new Float32Array([1, 1, 1]), width: 3, height: 1, cellPx: 1 } };
  layers.alpha = new Float32Array([0, 0.5, 1]);
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  check("_DTF.png: alpha 0 preservado (transparente, não branco)", rgbaAt(decoded, 3, 0, 0)[3] === 0);
  check("_DTF.png: alpha 0.5 -> 128", rgbaAt(decoded, 3, 1, 0)[3] === 128);
  check("_DTF.png: alpha 1 -> 255 (opaco)", rgbaAt(decoded, 3, 2, 0)[3] === 255);
}

// 14) White: none (sem afetar o composto), solid e halftone aparecem no PNG final.
{
  const layers = emptyLayers(20, 10); // white.mode === "none"
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  check("_DTF.png White none: pixel permanece transparente (sem White)", rgbaAt(decoded, 20, 5, 5)[3] === 0);
}
{
  const layers = emptyLayers(20, 10);
  layers.white = { mode: "solid", width: 20, height: 10, coverage: { data: new Float32Array(20 * 10).fill(1), width: 20, height: 10, cellPx: 1 } };
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  const [r, g, b, a] = rgbaAt(decoded, 20, 5, 5);
  check("_DTF.png White solid: pixel opaco e branco aparece", a === 255 && r === 255 && g === 255 && b === 255);
}
{
  const layers = emptyLayers(20, 10);
  layers.white = { mode: "halftone", width: 20, height: 10, dots: [dotAt(5, 5, 3)] };
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  check("_DTF.png White halftone: dot presente e opaco", rgbaAt(decoded, 20, 5, 5)[3] === 255);
}

// 15) Combinações CMYK no composto final: C, M, Y, K, C+M, C+Y, M+Y, C+M+Y.
{
  const w = 80,
    h = 10;
  const layers = emptyLayers(w, h);
  const combos: [string, (keyof Pick<PrintLayerSet, "cyan" | "magenta" | "yellow" | "black">)[]][] = [
    ["C", ["cyan"]],
    ["M", ["magenta"]],
    ["Y", ["yellow"]],
    ["K", ["black"]],
    ["C+M", ["cyan", "magenta"]],
    ["C+Y", ["cyan", "yellow"]],
    ["M+Y", ["magenta", "yellow"]],
    ["CMY", ["cyan", "magenta", "yellow"]],
  ];
  combos.forEach(([, channels], i) => {
    for (const ch of channels) layers[ch].push(dotAt(i * 10 + 5, 5, 4));
  });
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  const expectRgb: Record<string, [number, number, number]> = {
    C: [0, 255, 255],
    M: [255, 0, 255],
    Y: [255, 255, 0],
    K: [0, 0, 0],
    "C+M": [0, 0, 255],
    "C+Y": [0, 255, 0],
    "M+Y": [255, 0, 0],
    CMY: [0, 0, 0],
  };
  combos.forEach(([label], i) => {
    const [r, g, b, a] = rgbaAt(decoded, w, i * 10 + 5, 5);
    check(`_DTF.png combinação ${label}: cor subtrativa esperada`, r === expectRgb[label][0] && g === expectRgb[label][1] && b === expectRgb[label][2] && a === 255);
  });
}

// 16) Dots efetivamente processados (não recomputa a partir do RGB original): mesmas
// coordenadas em C e K permanecem alinhadas no composto final.
{
  const layers = emptyLayers(256, 256);
  layers.cyan = [dotAt(100, 200, 4)];
  layers.black = [dotAt(100, 200, 4)];
  const decoded = decodePng(exportFinalDtfPng(layers).bytes);
  check("_DTF.png alinhamento C+K em (100,200): opaco (ambos os canais coincidem)", rgbaAt(decoded, 256, 100, 200)[3] === 255);
}

// 17) Determinismo do PNG final.
{
  const layers = emptyLayers(40, 40);
  layers.magenta = [dotAt(20, 20, 5)];
  layers.white = { mode: "halftone", width: 40, height: 40, dots: [dotAt(5, 5, 2)] };
  const a = exportFinalDtfPng(layers).bytes;
  const b = exportFinalDtfPng(layers).bytes;
  check("_DTF.png determinismo: bytes idênticos entre execuções", a.length === b.length && a.every((v, idx) => v === b[idx]));
}

// 18) Teste real de arquivo: grava um PNG de verdade em disco e relê seus metadados.
{
  const layers = emptyLayers(120, 90);
  layers.cyan = [dotAt(30, 20, 4)];
  layers.black = [dotAt(90, 70, 4)];
  layers.white = { mode: "solid", width: 120, height: 90, coverage: { data: new Float32Array(120 * 90).fill(0.4), width: 120, height: 90, cellPx: 1 } };
  layers.alpha.fill(1);
  layers.alpha[0] = 0; // pixel (0,0) fica transparente para validar que não houve preenchimento branco
  const { bytes } = exportFinalDtfPng(layers, "final");
  mkdirSync("test-output", { recursive: true });
  writeFileSync("test-output/final-dtf-300dpi.png", bytes);
  const reread = decodePng(bytes);
  check("arquivo real: dimensão correta", reread.width === 120 && reread.height === 90);
  check("arquivo real: colorType RGBA", reread.colorType === 6);
  check("arquivo real: pHYs = 300 DPI", reread.dpi === 300);
  check("arquivo real: transparência preservada em (0,0), sem crop/deslocamento", rgbaAt(reread, 120, 0, 0)[3] === 0);
}

console.log(`${passed} testes passaram.`);

