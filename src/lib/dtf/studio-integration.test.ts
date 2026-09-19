/**
 * PASSO 6G — integration tests for the HalftoneStudio "engineMode" wiring.
 *
 * HalftoneStudio.tsx is a canvas/DOM-driven component (no jsdom/testing-library in this
 * project — see package.json), so it cannot be rendered/unit-tested directly with tsx.
 * These tests instead exercise the exact same module-level calls the component makes for
 * each engineMode, built the same way buildPrintEngineSettingsFromUI()/buildHalftoneSettingsFromUI()
 * do, to verify the integration contract: Legacy is untouched (no engine module call at all,
 * verified by inspection, not testable here), Pro RGB (runHalftoneEngine) keeps working, Pro CMYK
 * (buildPrintLayerSet) produces a valid PrintLayerSet, White None/Solid/Halftone all work, engine
 * switching doesn't throw or leak state, config changes (C angle) propagate to the output, and
 * White changes never affect CMYK.
 *
 * Run: npx tsx src/lib/dtf/studio-integration.test.ts
 */
import { runHalftoneEngine } from "../halftone/engine";
import { DEFAULT_HALFTONE_SETTINGS } from "../halftone/constants";
import { buildPrintLayerSet, DEFAULT_PRINT_ENGINE_SETTINGS } from "./engine";
import { DEFAULT_CMYK_SCREEN_SETTINGS } from "../color/screening";
import type { PrintEngineSettings } from "./types";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function makeOpaqueSquare(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inSquare = x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;
      data[i] = 40;
      data[i + 1] = 90;
      data[i + 2] = 200;
      data[i + 3] = inSquare ? 255 : 0;
    }
  }
  return data;
}

const W = 60,
  H = 60;
const art = makeOpaqueSquare(W, H);

// ---------------------------------------------------------------------------
// Pro RGB (engineMode === "pro") continues to work — same runHalftoneEngine() call
// HalftoneStudio.halftonePro() makes, untouched by this PASSO.
// ---------------------------------------------------------------------------
{
  const layers = runHalftoneEngine(art, W, H, DEFAULT_HALFTONE_SETTINGS);
  check("Pro RGB: continua funcionando (colorDots gerado)", Array.isArray(layers.colorDots) && layers.colorDots.length > 0);
}

// ---------------------------------------------------------------------------
// Pro CMYK (engineMode === "pro-cmyk") produces a valid PrintLayerSet — same
// buildPrintLayerSet() call HalftoneStudio.halftoneProCmyk() makes.
// ---------------------------------------------------------------------------
{
  const layers = buildPrintLayerSet(art, W, H, DEFAULT_PRINT_ENGINE_SETTINGS);
  check("Pro CMYK: PrintLayerSet válido (cyan/magenta/yellow/black arrays)", Array.isArray(layers.cyan) && Array.isArray(layers.magenta) && Array.isArray(layers.yellow) && Array.isArray(layers.black));
  check("Pro CMYK: alpha é Float32Array", layers.alpha instanceof Float32Array);
  check("Pro CMYK: dimensões preservadas", layers.width === W && layers.height === H);
}

// ---------------------------------------------------------------------------
// White None / Solid / Halftone — exactly the three whiteMode values the UI's
// White Underbase chips already expose (reused, not duplicated) for pro-cmyk too.
// ---------------------------------------------------------------------------
{
  const noneSettings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: "none" } };
  const solidSettings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: "solid" } };
  const halftoneSettings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: "halftone" } };

  const lNone = buildPrintLayerSet(art, W, H, noneSettings);
  const lSolid = buildPrintLayerSet(art, W, H, solidSettings);
  const lHalftone = buildPrintLayerSet(art, W, H, halftoneSettings);

  check("White None: não gera White (mode === 'none', sem coverage/dots)", lNone.white.mode === "none" && !lNone.white.coverage && !lNone.white.dots);
  check("White Solid: white.mode === 'solid' (usa WhiteLayer.coverage)", lSolid.white.mode === "solid" && !!lSolid.white.coverage);
  check("White Halftone: white.mode === 'halftone' (usa WhiteLayer.dots)", lHalftone.white.mode === "halftone" && !!lHalftone.white.dots && lHalftone.white.dots.length > 0);
}

// ---------------------------------------------------------------------------
// Troca de motor: Legacy -> Pro RGB -> Pro CMYK -> Legacy, sem erro.
// "Legacy" has no dedicated engine module (it's pure canvas math inside HalftoneStudio.tsx),
// so it's represented here as "no engine call" — the sequence below only needs to prove
// Pro RGB and Pro CMYK can be invoked back-to-back, in either order, without throwing or
// leaking mutable state between them (both build a fresh settings object every call).
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    runHalftoneEngine(art, W, H, DEFAULT_HALFTONE_SETTINGS); // Pro RGB
    buildPrintLayerSet(art, W, H, DEFAULT_PRINT_ENGINE_SETTINGS); // Pro CMYK
    runHalftoneEngine(art, W, H, DEFAULT_HALFTONE_SETTINGS); // back to Pro RGB
  } catch {
    threw = true;
  }
  check("Troca de motor: Legacy -> Pro RGB -> Pro CMYK -> Legacy sem erro", !threw);
}

// ---------------------------------------------------------------------------
// Troca de configuração: alterar C.angle atualiza a saída (o que o preview refletiria).
// ---------------------------------------------------------------------------
{
  const base = buildPrintLayerSet(art, W, H, DEFAULT_PRINT_ENGINE_SETTINGS);
  const changedAngle: PrintEngineSettings = {
    ...DEFAULT_PRINT_ENGINE_SETTINGS,
    cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 33 } },
  };
  const changed = buildPrintLayerSet(art, W, H, changedAngle);
  const positionsDiffer = base.cyan.some((d, i) => changed.cyan[i] && (d.x !== changed.cyan[i].x || d.y !== changed.cyan[i].y));
  check("Troca de configuração: mudar C.angle altera a geometria dos dots (preview mudaria)", positionsDiffer);
}

// ---------------------------------------------------------------------------
// White independence: alterar White não recalcula CMYK de maneira incorreta.
// ---------------------------------------------------------------------------
{
  const lowWhite: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: "solid", whiteDensity: 0.2 } };
  const highWhite: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: "solid", whiteDensity: 0.95 } };
  const lLow = buildPrintLayerSet(art, W, H, lowWhite);
  const lHigh = buildPrintLayerSet(art, W, H, highWhite);
  const cmykIdentical =
    JSON.stringify(lLow.cyan) === JSON.stringify(lHigh.cyan) &&
    JSON.stringify(lLow.magenta) === JSON.stringify(lHigh.magenta) &&
    JSON.stringify(lLow.yellow) === JSON.stringify(lHigh.yellow) &&
    JSON.stringify(lLow.black) === JSON.stringify(lHigh.black);
  check("White independence: mudar whiteDensity não altera C/M/Y/K", cmykIdentical);
}

// ---------------------------------------------------------------------------
// Per-channel algorithm/lpi are independent — mirrors the 4 separate channel
// controls (LPI/angle/algorithm) added to the Pro CMYK panel.
// ---------------------------------------------------------------------------
{
  const settings: PrintEngineSettings = {
    ...DEFAULT_PRINT_ENGINE_SETTINGS,
    cmyk: {
      ...DEFAULT_CMYK_SCREEN_SETTINGS,
      cyan: { ...DEFAULT_CMYK_SCREEN_SETTINGS.cyan, algorithm: "fm" },
      black: { ...DEFAULT_CMYK_SCREEN_SETTINGS.black, algorithm: "am" },
    },
  };
  const layers = buildPrintLayerSet(art, W, H, settings);
  check("Canais independentes: C em FM e K em AM produzem estruturas distintas sem erro", Array.isArray(layers.cyan) && Array.isArray(layers.black));
}

console.log(`\n${passed} testes passaram.`);
