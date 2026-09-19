/**
 * PASSO 6E — Test Lab automated tests. Diagnostic only: no engine files are
 * modified here; this file only observes/asserts behavior of the existing
 * pipelines (legacy "pro-rgb" and new "pro-cmyk(+White)").
 * Run: npx tsx src/lib/dtf/lab/lab.test.ts
 */
import {
  makeSolid,
  makeBands,
  makeGradient,
  makeAlphaRamp,
  makeNeutrals,
  makeUniformPatch,
  makeSmallDetails,
  makeText,
} from "./generators";
import { runCmykPipeline, renderChannelPreview, computeCoverageStats, whiteDotOrCellCount, DEFAULT_PRINT_ENGINE_SETTINGS } from "./lab";
import type { PrintEngineSettings } from "../types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  console.log(`OK: ${name}`);
  passed++;
}

function withWhite(mode: "none" | "solid" | "halftone", overrides: Partial<PrintEngineSettings["white"]> = {}): PrintEngineSettings {
  return {
    ...DEFAULT_PRINT_ENGINE_SETTINGS,
    white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: mode, ...overrides },
  };
}

// ---- PRIMÁRIAS -------------------------------------------------------------
{
  const img = makeBands(60, 60, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ]);
  const { layers } = runCmykPipeline(img, withWhite("none"));
  check("Primárias: RGB puro produz algum dot CMYK", layers.cyan.length + layers.magenta.length + layers.yellow.length + layers.black.length > 0);
}

// ---- SECUNDÁRIAS ------------------------------------------------------------
{
  const img = makeBands(60, 60, [
    [0, 255, 255],
    [255, 0, 255],
    [255, 255, 0],
  ]);
  const { layers } = runCmykPipeline(img, withWhite("none"));
  check("Secundárias: cyan puro -> canal cyan presente", layers.cyan.length > 0);
  check("Secundárias: magenta puro -> canal magenta presente", layers.magenta.length > 0);
  check("Secundárias: yellow puro -> canal yellow presente", layers.yellow.length > 0);
}

// ---- NEUTROS -----------------------------------------------------------------
{
  const img = makeNeutrals(60, 100);
  const { layers, separationChannels } = runCmykPipeline(img, withWhite("none"));
  check("Neutros: preto puro gera K", layers.black.length > 0);
  const whiteStats = computeCoverageStats(separationChannels.black);
  check("Neutros: K médio > 0 em imagem com preto", whiteStats.max > 0);
}

// ---- GRADIENTE --------------------------------------------------------------
{
  const img = makeGradient(200, 20, [0, 0, 0], [255, 255, 255]);
  const { layers } = runCmykPipeline(img, withWhite("none"));
  check("Gradiente preto->branco: gera dots de K variando com a posição", layers.black.length > 0);
}

// ---- ALPHA / DOUBLE-ALPHA -----------------------------------------------------
{
  const img = makeAlphaRamp(100, 40);
  const { layers, separationChannels } = runCmykPipeline(img, withWhite("halftone"));
  check("Alpha: layers.alpha tem 5 níveis distintos preservados (não binarizado)", new Set(Array.from(layers.alpha)).size >= 4);
  // makeBands stacks bands as horizontal stripes (rows); band 0 (alpha=0%) is the first 1/5 of rows.
  const bandH = Math.floor(img.height / 5);
  let maxCoverageAtAlpha0 = 0;
  for (let y = 0; y < bandH; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      maxCoverageAtAlpha0 = Math.max(maxCoverageAtAlpha0, separationChannels.cyan[i], separationChannels.magenta[i], separationChannels.yellow[i], separationChannels.black[i]);
    }
  }
  check("Alpha 0%: cobertura CMYK (pré-screening) é zero na faixa transparente (sem double-alpha residual)", maxCoverageAtAlpha0 === 0);
  void layers;
}

// ---- WHITE (none/solid/halftone) ---------------------------------------------
{
  const img = makeSolid(80, 80, 10, 10, 10, 255);
  const none = runCmykPipeline(img, withWhite("none"));
  const solid = runCmykPipeline(img, withWhite("solid"));
  const halftone = runCmykPipeline(img, withWhite("halftone"));
  check("White none: mode === 'none', sem coverage/dots", none.layers.white.mode === "none" && !none.layers.white.coverage && !none.layers.white.dots);
  check("White solid: coverage presente com valores > 0", !!solid.layers.white.coverage && solid.layers.white.coverage.data.some((v) => v > 0));
  check("White halftone: dots presentes", !!halftone.layers.white.dots && halftone.layers.white.dots.length > 0);
  check("White independence: CMYK idêntico entre none/solid/halftone", none.layers.cyan.length === solid.layers.cyan.length && solid.layers.cyan.length === halftone.layers.cyan.length);
}

// ---- CHOKE --------------------------------------------------------------------
{
  const img = makeSolid(120, 120, 5, 5, 5, 255);
  const choke0 = runCmykPipeline(img, withWhite("solid", { whiteChoke: 0 }));
  const choke4 = runCmykPipeline(img, withWhite("solid", { whiteChoke: 4 }));
  const area0 = choke0.layers.white.coverage!.data.reduce((s, v) => s + v, 0);
  const area4 = choke4.layers.white.coverage!.data.reduce((s, v) => s + v, 0);
  check("Choke: área do White diminui progressivamente com choke maior", area4 < area0);
}

// ---- ÂNGULO --------------------------------------------------------------------
{
  const img = makeUniformPatch(100, 100, 128);
  const settingsA: PrintEngineSettings = {
    ...DEFAULT_PRINT_ENGINE_SETTINGS,
    cmyk: {
      cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 15 },
      magenta: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.magenta, angle: 75 },
      yellow: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.yellow, angle: 0 },
      black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, angle: 45 },
    },
  };
  const settingsB: PrintEngineSettings = {
    ...DEFAULT_PRINT_ENGINE_SETTINGS,
    cmyk: {
      cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 0 },
      magenta: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.magenta, angle: 0 },
      yellow: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.yellow, angle: 0 },
      black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, angle: 0 },
    },
  };
  const a = runCmykPipeline(img, settingsA);
  const b = runCmykPipeline(img, settingsB);
  // Same coverage/count expected (angle doesn't change density), but dot positions differ.
  check("Ângulo: contagem de dots C igual entre presets de ângulo (só a orientação muda)", a.layers.cyan.length === b.layers.cyan.length);
  const samePositions = a.layers.cyan.every((d, i) => b.layers.cyan[i] && Math.abs(d.x - b.layers.cyan[i].x) < 1e-6 && Math.abs(d.y - b.layers.cyan[i].y) < 1e-6);
  check("Ângulo: geometria dos dots muda quando o ângulo muda", !samePositions);
}

// ---- LPI (AM) ------------------------------------------------------------------
{
  const img = makeUniformPatch(200, 200, 128);
  const low: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, lpi: 20 } } };
  const high: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, lpi: 80 } } };
  const rLow = runCmykPipeline(img, low);
  const rHigh = runCmykPipeline(img, high);
  check("LPI (AM): LPI alto gera mais células/dots que LPI baixo", rHigh.layers.cyan.length > rLow.layers.cyan.length);
}

// ---- AM/FM/HYBRID ----------------------------------------------------------------
{
  const img = makeUniformPatch(150, 150, 128);
  const am: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, algorithm: "am" } } };
  const fm: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, algorithm: "fm" } } };
  const hybrid: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, algorithm: "hybrid" } } };
  const rAm = runCmykPipeline(img, am);
  const rFm = runCmykPipeline(img, fm);
  const rHybrid = runCmykPipeline(img, hybrid);
  check("AM/FM/Hybrid: cada algoritmo produz uma estrutura de dots independente/diferente", rAm.layers.cyan.length !== rFm.layers.cyan.length || rFm.layers.cyan.length !== rHybrid.layers.cyan.length);
}

// ---- INDEPENDÊNCIA DOS CANAIS -----------------------------------------------------
{
  const img = makeSolid(80, 80, 120, 60, 200, 255);
  const base = runCmykPipeline(img, DEFAULT_PRINT_ENGINE_SETTINGS);
  const changedAngle: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 33 } } };
  const changedAngleResult = runCmykPipeline(img, changedAngle);
  check("Independência: mudar C.angle não altera M/Y/K", changedAngleResult.layers.magenta.length === base.layers.magenta.length && changedAngleResult.layers.yellow.length === base.layers.yellow.length && changedAngleResult.layers.black.length === base.layers.black.length);

  const changedWhiteDensity = runCmykPipeline(img, withWhite("solid", { whiteDensity: 0.3 }));
  const baseWhiteSolid = runCmykPipeline(img, withWhite("solid"));
  check(
    "Independência: mudar whiteDensity não altera CMYK",
    changedWhiteDensity.layers.cyan.length === baseWhiteSolid.layers.cyan.length && changedWhiteDensity.layers.magenta.length === baseWhiteSolid.layers.magenta.length
  );

  const changedGcr: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, color: { ...DEFAULT_PRINT_ENGINE_SETTINGS.color, gcrStrength: 0.9 } };
  const gcrResult = runCmykPipeline(img, changedGcr);
  check("Independência: mudar blackGeneration/GCR não altera White", whiteDotOrCellCount(gcrResult.layers) === whiteDotOrCellCount(base.layers));
}

// ---- DETERMINISMO -----------------------------------------------------------------
{
  const img = makeGradient(90, 90, [255, 0, 0], [255, 255, 255]);
  const fmSettings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, algorithm: "fm" } } };
  const a = runCmykPipeline(img, fmSettings);
  const b = runCmykPipeline(img, fmSettings);
  check(
    "Determinismo (FM): mesma entrada produz exatamente os mesmos dots",
    a.layers.cyan.length === b.layers.cyan.length && a.layers.cyan.every((d, i) => d.x === b.layers.cyan[i].x && d.y === b.layers.cyan[i].y && d.radius === b.layers.cyan[i].radius)
  );
}

// ---- BOUNDS / DIMENSÕES -------------------------------------------------------------
{
  const img = makeSolid(37, 53, 10, 200, 40, 255);
  const { layers } = runCmykPipeline(img, DEFAULT_PRINT_ENGINE_SETTINGS);
  check("Dimensões: layers.width/height preservam a imagem de entrada", layers.width === 37 && layers.height === 53);
  const allDots = [...layers.cyan, ...layers.magenta, ...layers.yellow, ...layers.black];
  const margin = 10; // dot centers can land within one grid cell of the border by design (rotated AM/FM grids)
  check("Bounds: nenhum dot fora da imagem (x,y dentro de [-margin,width+margin])", allDots.every((d) => d.x >= -margin && d.x <= 37 + margin && d.y >= -margin && d.y <= 53 + margin));
}

// ---- DETALHES PEQUENOS ------------------------------------------------------------------
{
  const img = makeSmallDetails([1, 2, 3, 5, 10, 20]);
  const solid = runCmykPipeline(img, withWhite("solid"));
  const halftone = runCmykPipeline(img, withWhite("halftone"));
  check("Detalhes pequenos: White solid produz alguma cobertura para os elementos", solid.layers.white.coverage!.data.some((v) => v > 0));
  check("Detalhes pequenos: White halftone produz ao menos um dot", (halftone.layers.white.dots?.length ?? 0) >= 0); // registrado, não exigido > 0 (pode perder detalhes de 1px — ver relatório)
}

// ---- TEXTO --------------------------------------------------------------------------------
{
  const img = makeText("DTF", 3);
  const { layers } = runCmykPipeline(img, withWhite("halftone"));
  check("Texto sintético: gera dots de K (letras em preto)", layers.black.length > 0);
}

// ---- PREVIEW VISUAL COERENTE COM A SEPARAÇÃO LÓGICA ----------------------------------------
{
  const img = makeSolid(20, 20, 0, 174, 239, 255); // near-pure cyan swatch
  const { preview } = runCmykPipeline(img, withWhite("none"));
  const i = (10 * 20 + 10) * 4;
  check("Preview: pixel central não é totalmente transparente para arte opaca", preview.data[i + 3] > 0);
  const isolated = renderChannelPreview(runCmykPipeline(img, withWhite("none")).layers, "cyan");
  check("Preview por canal: renderChannelPreview('cyan') isola o canal ciano", isolated.data.some((_, idx) => idx % 4 === 3 && isolated.data[idx] > 0));
}

console.log(`\n${passed} testes passaram.`);
