/**
 * PASSO 6E — Test Lab manual export script. Node-only, run via:
 *   npm run lab:export
 * Produces test-output/ with PNGs for visual inspection. Diagnostic tool only —
 * not the product's official exporter (see halftone/export.ts for that).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeBands,
  makeGradient,
  makeAlphaRamp,
  makeNeutrals,
  makeUniformPatch,
  makeSmallDetails,
  makeText,
} from "./generators";
import type { LabImage } from "./generators";
import { runLegacyPipeline, runCmykPipeline, renderChannelPreview, DEFAULT_PRINT_ENGINE_SETTINGS, DEFAULT_HALFTONE_SETTINGS } from "./lab";
import type { PrintEngineSettings } from "../types";
import type { RasterBuffer } from "../compose";
import { encodePng } from "./png";

const OUT_DIR = join(process.cwd(), "test-output");

function writeRaster(dir: string, name: string, buffer: RasterBuffer): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), encodePng(buffer.data, buffer.width, buffer.height));
}

/** Flattens RGBA onto an opaque backdrop before export — needed for the White channel preview
 * (painted as opaque white on a transparent buffer), which is otherwise indistinguishable from
 * an empty/transparent PNG when viewed against a typical white-background image viewer. */
function flattenOnBackground(buffer: RasterBuffer, bg: [number, number, number]): RasterBuffer {
  const out = new Uint8ClampedArray(buffer.data.length);
  for (let i = 0; i < buffer.data.length; i += 4) {
    const a = buffer.data[i + 3] / 255;
    out[i] = Math.round(buffer.data[i] * a + bg[0] * (1 - a));
    out[i + 1] = Math.round(buffer.data[i + 1] * a + bg[1] * (1 - a));
    out[i + 2] = Math.round(buffer.data[i + 2] * a + bg[2] * (1 - a));
    out[i + 3] = 255;
  }
  return { data: out, width: buffer.width, height: buffer.height };
}

function writeWhiteChannel(dir: string, name: string, buffer: RasterBuffer): void {
  writeRaster(dir, name, flattenOnBackground(buffer, [40, 40, 40]));
}

function writeImage(dir: string, name: string, img: LabImage): void {
  writeRaster(dir, name, { data: img.data, width: img.width, height: img.height });
}

function withWhite(mode: "none" | "solid" | "halftone", overrides: Partial<PrintEngineSettings["white"]> = {}): PrintEngineSettings {
  return { ...DEFAULT_PRINT_ENGINE_SETTINGS, white: { ...DEFAULT_PRINT_ENGINE_SETTINGS.white, whiteMode: mode, ...overrides } };
}

// ---- 1. Canonical fixed set (section 12 of the spec) ----------------------------
function exportMainSet() {
  const dir = join(OUT_DIR, "main");
  const img = makeBands(200, 300, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 128, 128, 200],
    [10, 10, 10],
  ]);
  writeImage(dir, "original", img);

  const legacy = runLegacyPipeline(img, { ...DEFAULT_HALFTONE_SETTINGS, whiteMode: "halftone" });
  writeRaster(dir, "pro-rgb", legacy.preview);

  const cmyk = runCmykPipeline(img, withWhite("halftone"));
  writeRaster(dir, "pro-cmyk-preview", cmyk.preview);
  ((["cyan", "magenta", "yellow", "black"] as const)).forEach((ch) => writeRaster(dir, ch, renderChannelPreview(cmyk.layers, ch)));
  writeRaster(dir, "alpha", renderChannelPreview(cmyk.layers, "alpha"));
  writeWhiteChannel(dir, "white", renderChannelPreview(cmyk.layers, "white"));

  const solid = runCmykPipeline(img, withWhite("solid"));
  writeWhiteChannel(dir, "white-solid", renderChannelPreview(solid.layers, "white"));
  const halftone = runCmykPipeline(img, withWhite("halftone"));
  writeWhiteChannel(dir, "white-halftone", renderChannelPreview(halftone.layers, "white"));
}

// ---- 2. Per-section scenario exports (sections 3-10) ---------------------------
function exportScenario(name: string, img: LabImage, settings: PrintEngineSettings = DEFAULT_PRINT_ENGINE_SETTINGS) {
  const dir = join(OUT_DIR, name);
  writeImage(dir, "original", img);
  const { preview } = runCmykPipeline(img, settings);
  writeRaster(dir, "pro-cmyk-preview", preview);
}

function exportTestLab(): void {
  exportMainSet();

  // TESTE A/B/E — primárias/secundárias/saturadas
  exportScenario("teste-a-primarias", makeBands(180, 270, [[255, 0, 0], [0, 255, 0], [0, 0, 255]]), withWhite("none"));
  exportScenario("teste-b-secundarias", makeBands(180, 270, [[0, 255, 255], [255, 0, 255], [255, 255, 0]]), withWhite("none"));
  exportScenario("teste-e-saturadas", makeBands(180, 420, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 0]]), withWhite("none"));

  // TESTE C — neutros
  exportScenario("teste-c-neutros", makeNeutrals(180, 300), withWhite("halftone"));

  // TESTE D — gradientes
  exportScenario("teste-d-gradiente-preto-branco", makeGradient(300, 60, [0, 0, 0], [255, 255, 255]));
  exportScenario("teste-d-gradiente-vermelho-branco", makeGradient(300, 60, [255, 0, 0], [255, 255, 255]));
  exportScenario("teste-d-gradiente-azul-branco", makeGradient(300, 60, [0, 0, 255], [255, 255, 255]));
  exportScenario("teste-d-gradiente-verde-branco", makeGradient(300, 60, [0, 255, 0], [255, 255, 255]));

  // TESTE F — transparência
  {
    const img = makeAlphaRamp(200, 100);
    const dir = join(OUT_DIR, "teste-f-transparencia");
    writeImage(dir, "original", img);
    const cmyk = runCmykPipeline(img, withWhite("halftone"));
    writeRaster(dir, "pro-cmyk-preview", cmyk.preview);
    writeRaster(dir, "alpha", renderChannelPreview(cmyk.layers, "alpha"));
    writeWhiteChannel(dir, "white", renderChannelPreview(cmyk.layers, "white"));
  }

  // TESTE 4 — ângulos: preset vs todos-zero, no mesmo patch uniforme
  {
    const img = makeUniformPatch(150, 150, 128);
    const dir = join(OUT_DIR, "teste-4-angulos");
    const preset = runCmykPipeline(img, DEFAULT_PRINT_ENGINE_SETTINGS);
    writeRaster(dir, "angulos-preset-15-75-0-45", preset.preview);
    const allZero: PrintEngineSettings = {
      ...DEFAULT_PRINT_ENGINE_SETTINGS,
      cmyk: {
        cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 0 },
        magenta: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.magenta, angle: 0 },
        yellow: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.yellow, angle: 0 },
        black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, angle: 0 },
      },
    };
    const zero = runCmykPipeline(img, allZero);
    writeRaster(dir, "angulos-todos-zero", zero.preview);
  }

  // TESTE 5 — LPI baixo/médio/alto (canal K isolado para clareza visual)
  {
    const img = makeUniformPatch(200, 200, 128);
    const dir = join(OUT_DIR, "teste-5-lpi");
    for (const [label, lpi] of [["baixo", 15], ["medio", 45], ["alto", 85]] as const) {
      const settings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, lpi } } };
      const { layers } = runCmykPipeline(img, settings);
      writeRaster(dir, `lpi-${label}-k`, renderChannelPreview(layers, "black"));
    }
  }

  // TESTE 6 — AM/FM/Hybrid (canal K isolado)
  {
    const img = makeGradient(200, 200, [255, 255, 255], [0, 0, 0]);
    const dir = join(OUT_DIR, "teste-6-algoritmo");
    for (const algorithm of ["am", "fm", "hybrid"] as const) {
      const settings: PrintEngineSettings = { ...DEFAULT_PRINT_ENGINE_SETTINGS, cmyk: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk, black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, algorithm } } };
      const { layers } = runCmykPipeline(img, settings);
      writeRaster(dir, `${algorithm}-k`, renderChannelPreview(layers, "black"));
    }
  }

  // TESTE 7 — White none/solid/halftone + choke 0/1/2/4 (isolated shapes so erosion is visible
  // against transparency — a full-canvas opaque fill would render as solid white regardless of choke).
  {
    const img = makeSmallDetails([40, 60, 80]);
    const dir = join(OUT_DIR, "teste-7-white");
    for (const mode of ["none", "solid", "halftone"] as const) {
      const { layers } = runCmykPipeline(img, withWhite(mode));
      writeWhiteChannel(dir, `white-${mode}`, renderChannelPreview(layers, "white"));
    }
    for (const choke of [0, 1, 2, 4]) {
      const { layers } = runCmykPipeline(img, withWhite("solid", { whiteChoke: choke }));
      writeWhiteChannel(dir, `white-solid-choke-${choke}`, renderChannelPreview(layers, "white"));
    }
  }

  // TESTE 8 — detalhes pequenos (White solid e halftone)
  {
    const img = makeSmallDetails([1, 2, 3, 5, 10, 20]);
    const dir = join(OUT_DIR, "teste-8-detalhes-pequenos");
    writeImage(dir, "original", img);
    const solid = runCmykPipeline(img, withWhite("solid"));
    writeWhiteChannel(dir, "white-solid", renderChannelPreview(solid.layers, "white"));
    const halftone = runCmykPipeline(img, withWhite("halftone"));
    writeWhiteChannel(dir, "white-halftone", renderChannelPreview(halftone.layers, "white"));
  }

  // TESTE 9 — texto sintético
  {
    const dir = join(OUT_DIR, "teste-9-texto");
    for (const text of ["OVERPIXEL", "DTF", "HALFTONE PRO", "CMYK", "WHITE"]) {
      const img = makeText(text, 4);
      const { layers } = runCmykPipeline(img, withWhite("halftone"));
      const slug = text.toLowerCase().replace(/\s+/g, "-");
      writeRaster(dir, `${slug}-k`, renderChannelPreview(layers, "black"));
      writeWhiteChannel(dir, `${slug}-white`, renderChannelPreview(layers, "white"));
    }
  }

  // TESTE 10 — roseta/moiré: ângulos distintos (preset) vs coincidentes
  {
    const img = makeUniformPatch(200, 200, 96);
    const dir = join(OUT_DIR, "teste-10-roseta-moire");
    const distinct = runCmykPipeline(img, DEFAULT_PRINT_ENGINE_SETTINGS);
    writeRaster(dir, "angulos-distintos", distinct.preview);
    const coincident: PrintEngineSettings = {
      ...DEFAULT_PRINT_ENGINE_SETTINGS,
      cmyk: {
        cyan: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.cyan, angle: 45 },
        magenta: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.magenta, angle: 45 },
        yellow: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.yellow, angle: 0 },
        black: { ...DEFAULT_PRINT_ENGINE_SETTINGS.cmyk.black, angle: 45 },
      },
    };
    const same = runCmykPipeline(img, coincident);
    writeRaster(dir, "angulos-coincidentes-cmk-45", same.preview);
  }

  console.log(`Test Lab export concluído em: ${OUT_DIR}`);
}

exportTestLab();
