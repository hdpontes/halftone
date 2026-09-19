"use client";

import { useEffect, useRef } from "react";
import "../app/halftone-studio.css";
import {
  DEFAULT_HALFTONE_SETTINGS,
  composeDtfPreview,
  exportDtfLayers,
  renderColorLayer,
  renderWhiteLayer,
  resolvePreset,
  runHalftoneEngine,
  validateDpiLpi,
  type HalftoneAlgorithm,
  type HalftoneSettings,
  type PreviewMode,
  type WhiteMode,
} from "../lib/halftone";
// PASSO 6G — Pro CMYK integration. Diagnostic-only modules (dtf/engine.ts, dtf/compose.ts) are
// consumed as-is; no math inside them is modified by this component.
import { buildPrintLayerSet } from "../lib/dtf/engine";
import { composePrintPreview, paintDots, paintCoverageGrid, CHANNEL_COLORS, type RasterBuffer } from "../lib/dtf/compose";
import type { PrintEngineSettings, PrintLayerSet } from "../lib/dtf/types";
import { DEFAULT_COLOR_SEPARATION_SETTINGS } from "../lib/color/separation";
import { DEFAULT_CMYK_SCREEN_SETTINGS, type ChannelScreenSettings } from "../lib/color/screening";
import { exportFinalDtfPng } from "../lib/dtf/export";

type EngineMode = "pro" | "legacy" | "pro-cmyk";
type CmykChannelKey = "cyan" | "magenta" | "yellow" | "black";
type CmykPreviewMode = "composite" | CmykChannelKey | "white";

const CMYK_CHANNELS: { key: CmykChannelKey; label: string }[] = [
  { key: "cyan", label: "Cyan (C)" },
  { key: "magenta", label: "Magenta (M)" },
  { key: "yellow", label: "Yellow (Y)" },
  { key: "black", label: "Black (K)" },
];

/**
 * Halftone Online Pro - client-side halftone studio (upload, remoção de fundo,
 * meio-tom por pontos com ângulo, tamanhos/DPI, zoom/pan e exportação em PNG).
 * Toda a geração de imagem roda no navegador via Canvas 2D.
 */
type ScreenShape = "round" | "diamond" | "square" | "ellipse" | "line" | "rosette";

type HalftonePreset = {
  mode: "dark" | "color" | "light";
  screenType: ScreenShape;
  mixEnabled: boolean;
  mixScreenType: ScreenShape;
  mixAmount: number;
  lpi: number;
  screenAngle: number;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  gain: number;
  dotGain: number;
  removePower: number;
  bgPower: number;
  colorResidual: number;
  saturation: number;
  contrast: number;
  protectTol: number;
  colorTol: number;
  dpi: number;
  fillFrame: boolean;
  removeHalo: boolean;
};

export default function HalftoneStudio() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const container: HTMLDivElement = rootRef.current;

    const $ = <T extends HTMLElement = HTMLElement>(id: string) => container.querySelector<T>("#" + id)!;
    const viewCanvas = $<HTMLCanvasElement>("viewCanvas");
    const vctx = viewCanvas.getContext("2d", { willReadFrequently: true })!;
    const original = document.createElement("canvas");
    const clean = document.createElement("canvas");
    const result = document.createElement("canvas");
    const displayCrop = document.createElement("canvas");
    const octx = original.getContext("2d", { willReadFrequently: true })!;
    const cctx = clean.getContext("2d", { willReadFrequently: true })!;
    const rctx = result.getContext("2d", { willReadFrequently: true })!;
    const dctx = displayCrop.getContext("2d", { willReadFrequently: true })!;
    [vctx, octx, cctx, rctx, dctx].forEach((c) => {
      c.imageSmoothingEnabled = false;
      c.imageSmoothingQuality = "low";
    });

    let img: HTMLImageElement | null = null;
    let imgName = "arte.png";
    let mode: "dark" | "color" | "light" = "dark";
    let dpi = 300;
    let zoom = 1;
    let showBefore = false;
    let pickingProtect = false;
    let pickingBg = false;
    let manualBgColor = false;
    let protectEnabled = true;
    let previewBg: "checker" | "black" | "white" | "custom" = "checker";
    let aspectRatio = 1;
    let protectedColors: { r: number; g: number; b: number }[] = [];
    let sampledBgColor = { r: 0, g: 0, b: 0 };
    let screenType: ScreenShape = "round";
    let mixEnabled = false;
    let mixScreenType: ScreenShape = "line";
    let mixAmount = 35;
    let lockRatio = true;
    let fillFrame = true;
    let removeHalo = false;

    // --- PASSO 2: Halftone Engine PRO (AM/FM/Hybrid + White Underbase) ---
    // engine="legacy" preserves the original pipeline above untouched as a fallback.
    // PASSO 6G adds engineMode="pro-cmyk" as a third, opt-in engine; default stays "pro" (unchanged).
    let engineMode: EngineMode = "pro";
    let algorithm: HalftoneAlgorithm = "am";
    let whiteMode: WhiteMode = "none";
    let whiteDensity = DEFAULT_HALFTONE_SETTINGS.whiteDensity;
    let whiteChoke = DEFAULT_HALFTONE_SETTINGS.whiteChoke;
    let whiteLpi = DEFAULT_HALFTONE_SETTINGS.whiteLpi;
    let whiteAngle = DEFAULT_HALFTONE_SETTINGS.whiteAngle;
    let whiteGamma = DEFAULT_HALFTONE_SETTINGS.whiteGamma;
    let whiteDotShape: ScreenShape = DEFAULT_HALFTONE_SETTINGS.whiteDotShape;
    let whiteAlgorithm: HalftoneAlgorithm = DEFAULT_HALFTONE_SETTINGS.whiteAlgorithm;
    let previewMode: PreviewMode = "color";
    let whiteLayerCanvas: HTMLCanvasElement | null = null;

    // --- PASSO 6G: Pro CMYK (independent C/M/Y/K screening + White + subtractive preview) ---
    // White reuses the whiteMode/whiteDensity/... vars above (never duplicated).
    let cyanAlgorithm: HalftoneAlgorithm = DEFAULT_CMYK_SCREEN_SETTINGS.cyan.algorithm;
    let magentaAlgorithm: HalftoneAlgorithm = DEFAULT_CMYK_SCREEN_SETTINGS.magenta.algorithm;
    let yellowAlgorithm: HalftoneAlgorithm = DEFAULT_CMYK_SCREEN_SETTINGS.yellow.algorithm;
    let blackAlgorithm: HalftoneAlgorithm = DEFAULT_CMYK_SCREEN_SETTINGS.black.algorithm;
    let cmykPreviewMode: CmykPreviewMode = "composite";
    let cmykLastLayers: PrintLayerSet | null = null;

    // Celulares têm bem menos memória/limite de dimensão de canvas do que desktop; limitar lado e área evita a página travar/recarregar em A2/A3.
    const isMobileDevice = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const maxSide = isMobileDevice ? 4000 : 9000;
    const maxMobileMegapixels = 11_000_000;

    function unitName(u: string) {
      return u === "cm" ? "cm" : u === "mm" ? "mm" : u === "in" ? "pol" : "px";
    }
    function pxToUnit(px: number, u: string, dpiVal = dpi) {
      if (u === "px") return px;
      if (u === "in") return px / Math.max(1, dpiVal);
      if (u === "cm") return (px / Math.max(1, dpiVal)) * 2.54;
      if (u === "mm") return (px / Math.max(1, dpiVal)) * 25.4;
      return px;
    }
    function unitToPx(v: string | number, u: string, dpiVal = dpi) {
      const n = Number(v) || 1;
      if (u === "px") return n;
      if (u === "in") return n * Math.max(1, dpiVal);
      if (u === "cm") return (n / 2.54) * Math.max(1, dpiVal);
      if (u === "mm") return (n / 25.4) * Math.max(1, dpiVal);
      return n;
    }
    function fmtUnit(v: number, u: string) {
      if (u === "px") return Math.round(v) + " px";
      const n = (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
      return n + " " + unitName(u);
    }
    function currentUnit() {
      return $<HTMLSelectElement>("sizeUnit") ? $<HTMLSelectElement>("sizeUnit").value : "cm";
    }
    function clamp(v: number, a: number, b: number) {
      return Math.max(a, Math.min(b, v));
    }
    function lum(r: number, g: number, b: number) {
      return 0.299 * r + 0.587 * g + 0.114 * b;
    }
    function sat(r: number, g: number, b: number) {
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      return mx ? (mx - mn) / mx : 0;
    }
    function dist(r: number, g: number, b: number, c: { r: number; g: number; b: number }) {
      const dr = r - c.r,
        dg = g - c.g,
        db = b - c.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }
    function hex(c: { r: number; g: number; b: number }) {
      return (
        "#" +
        [c.r, c.g, c.b]
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
      );
    }
    function setStatus(t: string) {
      $("status").textContent = t;
    }
    function loading(on: boolean, msg = "Processando...") {
      $("stageLoading").classList.toggle("on", !!on);
      $("stageLoading").querySelector("span")!.textContent = msg;
    }
    function updatePickCursor() {
      const active = !!(pickingBg || pickingProtect);
      $("viewer").classList.toggle("picking", active);
      $("canvasWrap").classList.toggle("picking", active);
    }
    function colorResidualBoost() {
      return Number(($("colorResidual") as HTMLInputElement | null)?.value || 0);
    }
    function labels() {
      $("gainVal").textContent = Number(($("gain") as HTMLInputElement).value).toFixed(2);
      $("dotGainVal").textContent = (Number(($("dotGain") as HTMLInputElement).value) > 0 ? "+" : "") + ($("dotGain") as HTMLInputElement).value + "%";
      $("removeVal").textContent = ($("removePower") as HTMLInputElement).value;
      $("bgPowerVal").textContent = ($("bgPower") as HTMLInputElement).value;
      const colorResidualVal = container.querySelector("#colorResidualVal");
      if (colorResidualVal) colorResidualVal.textContent = ($("colorResidual") as HTMLInputElement).value;
      $("satVal").textContent = ($("saturation") as HTMLInputElement).value + "%";
      $("contrastVal").textContent = ($("contrast") as HTMLInputElement).value;
      $("lpiVal").textContent = ($("lpi") as HTMLInputElement).value;
      $("angleVal").textContent = ($("screenAngle") as HTMLInputElement).value + "°";
      $("blackPointVal").textContent = ($("blackPoint") as HTMLInputElement).value;
      $("whitePointVal").textContent = ($("whitePoint") as HTMLInputElement).value;
      $("gammaVal").textContent = Number(($("gamma") as HTMLInputElement).value).toFixed(1);
      const mixValEl = container.querySelector("#mixVal");
      if (mixValEl) mixValEl.textContent = ($("mixAmount") as HTMLInputElement).value;
      $("protectTolVal").textContent = ($("protectTol") as HTMLInputElement).value;
      const colorTolVal = container.querySelector("#colorTolVal");
      if (colorTolVal) colorTolVal.textContent = ($("colorTol") as HTMLInputElement).value;
      const bgColorText = container.querySelector("#bgColorText");
      if (bgColorText) bgColorText.textContent = hex(sampledBgColor);
      const bgColorSwatch = container.querySelector<HTMLElement>("#bgColorSwatch");
      if (bgColorSwatch) bgColorSwatch.style.background = hex(sampledBgColor);
      $("zoomVal").textContent = Math.round(zoom * 100) + "%";
      $("zoomBadge").textContent = Math.round(zoom * 100) + "%";
      const wrap = container.querySelector<HTMLElement>("#colorResidualWrap");
      if (wrap) wrap.style.display = mode === "color" ? "block" : "none";
      const whiteDensityEl = container.querySelector("#whiteDensityVal");
      if (whiteDensityEl) whiteDensityEl.textContent = ($("whiteDensity") as HTMLInputElement).value + "%";
      const whiteChokeEl = container.querySelector("#whiteChokeVal");
      if (whiteChokeEl) whiteChokeEl.textContent = ($("whiteChoke") as HTMLInputElement).value + "px";
      const whiteLpiEl = container.querySelector("#whiteLpiVal");
      if (whiteLpiEl) whiteLpiEl.textContent = ($("whiteLpi") as HTMLInputElement).value;
      const whiteAngleEl = container.querySelector("#whiteAngleVal");
      if (whiteAngleEl) whiteAngleEl.textContent = ($("whiteAngle") as HTMLInputElement).value + "°";
      const whiteGammaEl = container.querySelector("#whiteGammaVal");
      if (whiteGammaEl) whiteGammaEl.textContent = Number(($("whiteGamma") as HTMLInputElement).value).toFixed(2);
      CMYK_CHANNELS.forEach(({ key }) => {
        const lpiEl = container.querySelector(`#${key}LpiVal`);
        const lpiInput = container.querySelector<HTMLInputElement>(`#${key}Lpi`);
        if (lpiEl && lpiInput) lpiEl.textContent = lpiInput.value;
        const angleEl = container.querySelector(`#${key}AngleVal`);
        const angleInput = container.querySelector<HTMLInputElement>(`#${key}Angle`);
        if (angleEl && angleInput) angleEl.textContent = angleInput.value + "°";
      });
      updateLpiAvailability();
      updateCmykLpiAvailability();
    }
    // PASSO 4: em FM, o LPI não é utilizado (a densidade micro é controlada pela
    // matemática interna do FM, não por uma grade AM). Não altera a matemática do FM —
    // apenas desabilita/anota visualmente o controle de LPI correspondente.
    function updateLpiAvailability() {
      const lpiInput = container.querySelector<HTMLInputElement>("#lpi");
      const lpiNote = container.querySelector<HTMLElement>("#lpiFmNote");
      const isColorFm = algorithm === "fm";
      if (lpiInput) lpiInput.disabled = isColorFm;
      if (lpiNote) lpiNote.style.display = isColorFm ? "block" : "none";

      const whiteLpiInput = container.querySelector<HTMLInputElement>("#whiteLpi");
      const whiteLpiNote = container.querySelector<HTMLElement>("#whiteLpiFmNote");
      const isWhiteFm = whiteAlgorithm === "fm";
      if (whiteLpiInput) whiteLpiInput.disabled = isWhiteFm;
      if (whiteLpiNote) whiteLpiNote.style.display = isWhiteFm ? "block" : "none";
    }
    // PASSO 6G: same "FM ignores LPI" convention as updateLpiAvailability(), applied per CMYK channel.
    function cmykChannelAlgorithm(key: CmykChannelKey): HalftoneAlgorithm {
      if (key === "cyan") return cyanAlgorithm;
      if (key === "magenta") return magentaAlgorithm;
      if (key === "yellow") return yellowAlgorithm;
      return blackAlgorithm;
    }
    function updateCmykLpiAvailability() {
      CMYK_CHANNELS.forEach(({ key }) => {
        const lpiInput = container.querySelector<HTMLInputElement>(`#${key}Lpi`);
        const note = container.querySelector<HTMLElement>(`#${key}LpiFmNote`);
        const isFm = cmykChannelAlgorithm(key) === "fm";
        if (lpiInput) lpiInput.disabled = isFm;
        if (note) note.style.display = isFm ? "block" : "none";
      });
    }
    function updateCmykExportState() {
      const btn = container.querySelector<HTMLButtonElement>("#saveBtn");
      if (!btn) return;
      const isCmyk = engineMode === "pro-cmyk";
      btn.disabled = false;
      btn.title = isCmyk ? "Gera o PNG final DTF (White + CMYK + Alpha) em 300 DPI, pronto para impressão." : "";
      btn.textContent = isCmyk ? "Salvar PNG (300 DPI)" : "Baixar PNG";
    }
    function setEngineMode(next: EngineMode) {
      engineMode = next;
      const cmykSection = container.querySelector<HTMLElement>("#proCmykSection");
      if (cmykSection) cmykSection.style.display = engineMode === "pro-cmyk" ? "block" : "none";
      updateCmykExportState();
    }
    function targetSize(): [number, number] {
      if (!img) return [0, 0];
      const u = currentUnit();
      const w = Math.max(1, Math.round(unitToPx(($("customWidth") as HTMLInputElement).value, u, dpi)));
      const h = Math.max(1, Math.round(unitToPx(($("customHeight") as HTMLInputElement).value, u, dpi)));
      let cap = Math.min(1, maxSide / Math.max(w, h));
      if (isMobileDevice) {
        const area = w * h * cap * cap;
        if (area > maxMobileMegapixels) cap *= Math.sqrt(maxMobileMegapixels / area);
      }
      return [Math.round(w * cap), Math.round(h * cap)];
    }
    function setCanv(w: number, h: number) {
      [original, clean, result, viewCanvas].forEach((c) => {
        c.width = w;
        c.height = h;
      });
      [vctx, octx, cctx, rctx].forEach((c) => {
        c.imageSmoothingEnabled = false;
        c.imageSmoothingQuality = "low";
      });
    }
    function sampleBorder() {
      const w = original.width,
        h = original.height,
        d = octx.getImageData(0, 0, w, h).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      const step = Math.max(1, Math.floor(Math.max(w, h) / 180));
      function add(x: number, y: number) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 10) return;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      for (let x = 0; x < w; x += step) {
        add(x, 0);
        add(x, h - 1);
      }
      for (let y = 0; y < h; y += step) {
        add(0, y);
        add(w - 1, y);
      }
      return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
    }
    function quantKey(r: number, g: number, b: number) {
      return `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
    }
    function setBgColor(c: { r: number; g: number; b: number }, manual = false) {
      sampledBgColor = { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
      manualBgColor = manual;
      labels();
    }
    function detectBorderColor(manual = false) {
      if (!original.width || !original.height) {
        setBgColor({ r: 0, g: 0, b: 0 }, manual);
        return sampledBgColor;
      }
      const w = original.width,
        h = original.height,
        d = octx.getImageData(0, 0, w, h).data;
      const step = Math.max(1, Math.floor(Math.max(w, h) / 260));
      const map = new Map<string, { count: number; r: number; g: number; b: number }>();
      function add(x: number, y: number) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 10) return;
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const key = quantKey(r, g, b);
        const item = map.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        item.count++;
        item.r += r;
        item.g += g;
        item.b += b;
        map.set(key, item);
      }
      for (let x = 0; x < w; x += step) {
        add(x, 0);
        add(x, h - 1);
      }
      for (let y = 0; y < h; y += step) {
        add(0, y);
        add(w - 1, y);
      }
      let best: { count: number; r: number; g: number; b: number } | null = null;
      for (const item of map.values()) if (!best || item.count > best.count) best = item;
      if (best) setBgColor({ r: best.r / best.count, g: best.g / best.count, b: best.b / best.count }, manual);
      return sampledBgColor;
    }

    function darkBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 0, g: 0, b: 0 }) {
      if (a < 8) return true;
      const L = lum(r, g, b),
        S = sat(r, g, b);
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        chroma = mx - mn;
      const bgDist = dist(r, g, b, bg || { r: 0, g: 0, b: 0 });
      const softCut = 14 + power * 1.12;
      const hardCut = 26 + power * 0.7;
      const distCut = 22 + power * 1.1;
      if (bgDist <= distCut && L <= hardCut + 42) return true;
      if (mx <= softCut + 20 && L <= softCut) return true;
      if (L <= hardCut && (S < 0.96 || chroma < 54)) return true;
      if (power >= 120) {
        const extra = (power - 120) / 80;
        const aggressiveCut = 112 + extra * 64;
        if (L <= aggressiveCut && mx <= aggressiveCut + 34 && S < 0.98) return true;
        if (power >= 175 && L <= 170 && mx <= 205) return true;
      }
      return false;
    }
    function lightBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 255, g: 255, b: 255 }) {
      if (a < 8) return true;
      const L = lum(r, g, b),
        S = sat(r, g, b);
      const bgDist = dist(r, g, b, bg || { r: 255, g: 255, b: 255 });
      const cut = 255 - power * 1.05;
      const satLimit = Math.min(0.72, 0.22 + power / 145);
      if (L >= cut && S <= satLimit) return true;
      if (bgDist <= 16 + power * 0.55 && L >= Math.max(165, cut - 30)) return true;
      if (power >= 120) {
        const extra = (power - 120) / 80;
        const aggressiveCut = 205 + extra * 38;
        const aggressiveSat = Math.min(0.88, 0.28 + extra * 0.34);
        if (L >= aggressiveCut && S <= aggressiveSat) return true;
        if (power >= 175 && L >= 184 && S <= 0.92) return true;
      }
      return false;
    }
    function colorBgCandidate(r: number, g: number, b: number, a: number, power = 0, bg = { r: 255, g: 255, b: 255 }) {
      if (a < 8) return true;
      const S = sat(r, g, b),
        L = lum(r, g, b);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual * 0.85;
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const tol = baseTol + effectivePower * 0.35;
      const bgDist = dist(r, g, b, bg || { r: 255, g: 255, b: 255 });
      if (bgDist <= tol) return true;
      if (effectivePower >= 120) {
        const extra = (effectivePower - 120) / 80;
        const aggressiveTol = tol + 18 + extra * 28;
        if (bgDist <= aggressiveTol && (S < 0.96 || L > 30)) return true;
        if (effectivePower >= 175 && bgDist <= aggressiveTol + 18) return true;
      }
      return false;
    }
    function residualBgCandidate(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, power: number) {
      if (kind === "dark") return darkBgCandidate(r, g, b, a, power, bg);
      if (kind === "light") return lightBgCandidate(r, g, b, a, power, bg);
      return colorBgCandidate(r, g, b, a, power, bg);
    }
    function bgMatchPixel(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, power: number, globalPower: number) {
      if (a < 8) return true;
      if (kind === "dark") {
        const p = Math.max(power, globalPower * 0.72);
        return residualBgCandidate(r, g, b, a, bg, kind, p);
      }
      return residualBgCandidate(r, g, b, a, bg, kind, power);
    }
    function bgGlobalMatch(r: number, g: number, b: number, a: number, bg: { r: number; g: number; b: number }, kind: string, globalPower: number) {
      if (a < 8) return true;
      if (globalPower <= 0) return false;
      if (kind === "dark") return residualBgCandidate(r, g, b, a, bg, kind, globalPower);
      if (kind === "light") return residualBgCandidate(r, g, b, a, bg, kind, Math.max(globalPower, globalPower * 0.92));
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const tol = Math.max(0, baseTol - 16) + globalPower * 0.75;
      const bgDist = dist(r, g, b, bg);
      if (bgDist <= tol) return true;
      if (globalPower >= 120) return residualBgCandidate(r, g, b, a, bg, kind, Math.min(200, globalPower + 18));
      return false;
    }
    function createBorderMask() {
      const w = original.width,
        h = original.height;
      const d = octx.getImageData(0, 0, w, h).data;
      const power = Number(($("removePower") as HTMLInputElement).value);
      const globalPower = Number(($("bgPower") as HTMLInputElement).value);
      if (mode === "color" && !manualBgColor) detectBorderColor(false);
      const bg = mode === "color" ? sampledBgColor : sampleBorder();
      const arr = new Uint8Array(w * h),
        q = new Int32Array(w * h);
      let head = 0,
        tail = 0;
      function isBg(x: number, y: number) {
        const i = (y * w + x) * 4;
        return bgMatchPixel(d[i], d[i + 1], d[i + 2], d[i + 3], bg, mode, power, globalPower);
      }
      function push(x: number, y: number) {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const idx = y * w + x;
        if (arr[idx] || !isBg(x, y)) return;
        arr[idx] = 1;
        q[tail++] = idx;
      }
      for (let x = 0; x < w; x++) {
        push(x, 0);
        push(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        push(0, y);
        push(w - 1, y);
      }
      while (head < tail) {
        const idx = q[head++],
          x = idx % w,
          y = (idx / w) | 0;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
      }
      let cur = arr;
      let expand = mode === "light" ? 3 : 2;
      expand += Math.floor(globalPower / 45);
      expand = Math.min(6, expand);
      for (let e = 0; e < expand; e++) {
        const next = new Uint8Array(cur);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (cur[i]) continue;
            if (cur[i - 1] || cur[i + 1] || cur[i - w] || cur[i + w]) next[i] = 1;
          }
        }
        cur = next;
      }
      return { mask: cur, bg, globalPower };
    }
    function removeResidualBgGhosts(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      const w = clean.width,
        h = clean.height,
        d = imgd.data;
      const userPower = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      if (userPower <= 0 && mode !== "dark") return;
      const power = Math.max(34, userPower);
      const src = new Uint8ClampedArray(d);
      const radius = power >= 120 ? 4 : power >= 82 ? 3 : 2;
      const aggressive = power >= 120;

      function isResidualAt(p: number, localPower = power) {
        const a = src[p + 3];
        if (a < 8) return true;
        return residualBgCandidate(src[p], src[p + 1], src[p + 2], a, bg || { r: 0, g: 0, b: 0 }, mode, localPower);
      }
      function hasArtNeighbor(x: number, y: number) {
        let colored = 0,
          bright = 0,
          opaque = 0,
          contrast = 0;
        const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
        for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
          for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4,
              a = src[p + 3];
            if (a < 24) continue;
            opaque++;
            const r = src[p],
              g = src[p + 1],
              b = src[p + 2];
            const L = lum(r, g, b),
              S = sat(r, g, b),
              mx = Math.max(r, g, b);
            const bgDist = dist(r, g, b, bg || { r: 0, g: 0, b: 0 });
            if (mode === "dark") {
              if (L > 128 || mx > 168) bright++;
              if ((S > 0.34 && L > 42) || L > 105) colored++;
            } else if (mode === "light") {
              if (L < 220 || mx < 242) bright++;
              if (S > 0.12 || L < 238) colored++;
              if (bgDist > 28) contrast++;
            } else {
              if (L > 120 || mx > 165) bright++;
              if (S > 0.22 || bgDist > localTol * 0.82) colored++;
              if (bgDist > localTol * 0.7) contrast++;
            }
          }
        }
        if (mode === "dark") return aggressive ? bright >= 2 || colored >= 4 : colored >= 2 || opaque >= 14;
        if (mode === "light") return aggressive ? bright >= 2 || contrast >= 2 || colored >= 3 : contrast >= 1 || colored >= 4 || opaque >= 14;
        return aggressive ? contrast >= 2 || colored >= 4 || bright >= 2 : contrast >= 1 || colored >= 3 || opaque >= 14;
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          if (d[p + 3] < 8) continue;
          if (!isResidualAt(p)) continue;
          if (aggressive || !hasArtNeighbor(x, y)) {
            if (!hasArtNeighbor(x, y) || power >= 165) d[p + 3] = 0;
          }
        }
      }

      const after = new Uint8ClampedArray(d);
      const seen = new Uint8Array(w * h);
      const q = new Int32Array(w * h);
      const maxArea = mode === "dark" ? (aggressive ? 4200 : 900) : mode === "light" ? (aggressive ? 5200 : 1200) : aggressive ? 4600 : 1100;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const start = y * w + x;
          if (seen[start]) continue;
          const p0 = start * 4;
          if (after[p0 + 3] < 8 || !residualBgCandidate(after[p0], after[p0 + 1], after[p0 + 2], after[p0 + 3], bg || { r: 0, g: 0, b: 0 }, mode, power)) {
            seen[start] = 1;
            continue;
          }
          let head = 0,
            tail = 0,
            area = 0,
            touchEdge = false,
            artTouch = 0;
          q[tail++] = start;
          seen[start] = 1;
          while (head < tail) {
            const idx = q[head++],
              xx = idx % w,
              yy = (idx / w) | 0;
            area++;
            if (xx <= 1 || yy <= 1 || xx >= w - 2 || yy >= h - 2) touchEdge = true;
            const pp = idx * 4;
            const rr = after[pp],
              gg = after[pp + 1],
              bb = after[pp + 2];
            const LL = lum(rr, gg, bb),
              SS = sat(rr, gg, bb),
              MM = Math.max(rr, gg, bb);
            const bgDist = dist(rr, gg, bb, bg || { r: 0, g: 0, b: 0 });
            if (mode === "dark") {
              if (LL > 120 || (SS > 0.38 && LL > 54) || MM > 170) artTouch++;
            } else if (mode === "light") {
              if (LL < 225 || SS > 0.12 || bgDist > 28) artTouch++;
            } else {
              const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
              if (SS > 0.24 || bgDist > localTol * 0.78 || LL < 235) artTouch++;
            }
            const ns = [idx - 1, idx + 1, idx - w, idx + w];
            for (const ni of ns) {
              if (ni < 0 || ni >= w * h || seen[ni]) continue;
              const nx = ni % w,
                ny = (ni / w) | 0;
              if (Math.abs(nx - xx) + Math.abs(ny - yy) !== 1) continue;
              const p = ni * 4;
              if (after[p + 3] >= 8 && residualBgCandidate(after[p], after[p + 1], after[p + 2], after[p + 3], bg || { r: 0, g: 0, b: 0 }, mode, power)) {
                seen[ni] = 1;
                q[tail++] = ni;
              }
            }
          }
          const remove = touchEdge || area <= maxArea || (aggressive && artTouch < Math.max(10, area * 0.015));
          if (remove) {
            for (let i = 0; i < tail; i++) {
              const p = q[i] * 4;
              d[p + 3] = 0;
            }
          }
        }
      }
    }

    function cleanupColorEdgeSpill(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const w = clean.width,
        h = clean.height,
        d = imgd.data;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const effectivePower = power + extraResidual;
      const softTol = baseTol + Math.max(10, effectivePower * 0.24);
      const hardTol = baseTol + 22 + effectivePower * 0.34;
      const src = new Uint8ClampedArray(d);

      function touchesTransparent(x: number, y: number) {
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4;
            if (src[p + 3] < 8) return true;
          }
        }
        return false;
      }
      function inwardContrast(x: number, y: number, currentDist: number) {
        let best = currentDist;
        let strong = 0;
        let opaque = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
          for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4;
            const a = src[p + 3];
            if (a < 24) continue;
            opaque++;
            const nd = dist(src[p], src[p + 1], src[p + 2], bg || { r: 255, g: 255, b: 255 });
            if (nd > best) best = nd;
            if (nd > currentDist + 14) strong++;
          }
        }
        return { best, strong, opaque };
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          const a = d[p + 3];
          if (a < 8) continue;
          if (!touchesTransparent(x, y)) continue;
          const currentDist = dist(d[p], d[p + 1], d[p + 2], bg || { r: 255, g: 255, b: 255 });
          if (currentDist > hardTol + 28) continue;
          const S = sat(d[p], d[p + 1], d[p + 2]);
          const L = lum(d[p], d[p + 1], d[p + 2]);
          const contrast = inwardContrast(x, y, currentDist);
          const edgeLikelySpill = contrast.opaque >= 2 && contrast.strong >= 1 && contrast.best > currentDist + 12;
          if (!edgeLikelySpill) continue;

          if (currentDist <= softTol || (currentDist <= hardTol && contrast.best > currentDist + 22)) {
            d[p + 3] = 0;
            continue;
          }
          let keep = 0.34;
          if (effectivePower >= 120) keep = 0.12;
          else if (effectivePower >= 80) keep = 0.2;
          if (S < 0.18 || L > 180) keep *= 0.72;
          d[p + 3] = Math.round(a * keep);
        }
      }
    }

    function cleanupResultColorSpill() {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      if (effectivePower < 30) return;
      const bg = sampledBgColor || sampleBorder() || { r: 255, g: 255, b: 255 };
      const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const w = result.width,
        h = result.height;
      const imgd = rctx.getImageData(0, 0, w, h),
        d = imgd.data;
      const src = new Uint8ClampedArray(d);

      function nearTransparency(x: number, y: number) {
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            if (xx === x && yy === y) continue;
            const p = (yy * w + xx) * 4;
            if (src[p + 3] < 8) return true;
          }
        }
        return false;
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          const a = src[p + 3];
          if (a < 8) continue;
          if (!nearTransparency(x, y)) continue;
          const bgDist = dist(src[p], src[p + 1], src[p + 2], bg);
          if (bgDist > localTol + 26 + effectivePower * 0.24) continue;
          const S = sat(src[p], src[p + 1], src[p + 2]);
          const L = lum(src[p], src[p + 1], src[p + 2]);
          if (bgDist <= localTol + 10 || effectivePower >= 105) {
            d[p + 3] = 0;
          } else if (bgDist <= localTol + 24) {
            let keep = 0.45;
            if (effectivePower >= 80) keep = 0.2;
            if (S < 0.18 || L > 180) keep *= 0.75;
            d[p + 3] = Math.round(a * keep);
          }
        }
      }
      rctx.putImageData(imgd, 0, 0);
    }

    function cleanupColorContaminationGlobal(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      if (effectivePower < 20) return;
      const d = imgd.data;
      const baseTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const killTol = baseTol + 18 + effectivePower * 0.58;
      const fadeTol = killTol + 34 + effectivePower * 0.22;
      const hardMode = effectivePower >= 85;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 8) continue;
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg || { r: 255, g: 255, b: 255 });
        if (bgDist > fadeTol) continue;
        const S = sat(d[i], d[i + 1], d[i + 2]);
        const L = lum(d[i], d[i + 1], d[i + 2]);
        if (bgDist <= killTol) {
          d[i + 3] = 0;
          continue;
        }
        let keep = 0.24;
        if (hardMode) keep = 0.08;
        else if (effectivePower >= 60) keep = 0.08;
        if (S < 0.28 || L > 160) keep *= 0.72;
        d[i + 3] = Math.round(a * keep);
      }
    }

    function decontaminateColorBackground(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      const tol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const d = imgd.data;
      const fadeTol = tol + 42 + effectivePower * 0.46;
      const hardTol = tol + 18 + effectivePower * 0.36;
      const maxMix = effectivePower >= 110 ? 0.94 : effectivePower >= 70 ? 0.86 : 0.72;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 8) continue;
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg || { r: 255, g: 255, b: 255 });
        if (bgDist > fadeTol) continue;
        const alphaNorm = a / 255;
        let contam = clamp((fadeTol - bgDist) / Math.max(1, fadeTol - hardTol), 0, 1);
        if (alphaNorm < 1) contam = Math.max(contam, (1 - alphaNorm) * 0.9);
        if (contam <= 0) continue;
        if (bgDist <= hardTol * 0.72) {
          d[i + 3] = 0;
          continue;
        }
        const mix = clamp(contam * maxMix, 0, 0.92);
        const denom = Math.max(0.12, 1 - mix);
        const nr = (d[i] - bg.r * mix) / denom;
        const ng = (d[i + 1] - bg.g * mix) / denom;
        const nb = (d[i + 2] - bg.b * mix) / denom;
        d[i] = clamp(nr, 0, 255);
        d[i + 1] = clamp(ng, 0, 255);
        d[i + 2] = clamp(nb, 0, 255);
        let na = a * (1 - mix * 0.58);
        if (bgDist <= hardTol) na *= 0.55;
        d[i + 3] = clamp(Math.round(na), 0, 255);
      }
    }

    function cleanupResultColorContaminationGlobal() {
      if (mode !== "color") return;
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      const extraResidual = colorResidualBoost();
      const effectivePower = power + extraResidual;
      if (effectivePower < 25) return;
      const bg = sampledBgColor || sampleBorder() || { r: 255, g: 255, b: 255 };
      const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      const strictTol = localTol + 26 + effectivePower * 0.48;
      const fadeTol = strictTol + 28;
      const imgd = rctx.getImageData(0, 0, result.width, result.height),
        d = imgd.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 8) continue;
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg);
        if (bgDist > fadeTol) continue;
        const S = sat(d[i], d[i + 1], d[i + 2]);
        const L = lum(d[i], d[i + 1], d[i + 2]);
        if (bgDist <= strictTol || effectivePower >= 105) {
          d[i + 3] = 0;
        } else {
          let keep = 0.22;
          if (effectivePower >= 80) keep = 0.06;
          if (S < 0.26 || L > 165) keep *= 0.75;
          d[i + 3] = Math.round(a * keep);
        }
      }
      rctx.putImageData(imgd, 0, 0);
    }
    function removeBg() {
      const w = original.width,
        h = original.height;
      cctx.clearRect(0, 0, w, h);
      cctx.drawImage(original, 0, 0);
      const imgd = cctx.getImageData(0, 0, w, h),
        d = imgd.data;
      const info = createBorderMask();
      const bm = info.mask,
        bg = info.bg,
        globalPower = info.globalPower;
      for (let i = 0; i < bm.length; i++) {
        const p = i * 4;
        if (bm[i] || bgGlobalMatch(d[p], d[p + 1], d[p + 2], d[p + 3], bg, mode, globalPower)) d[p + 3] = 0;
      }
      removeResidualBgGhosts(imgd, bg);
      cleanupColorEdgeSpill(imgd, bg);
      cleanupColorContaminationGlobal(imgd, bg);
      decontaminateColorBackground(imgd, bg);
      if (removeHalo) removeBackgroundHalo(imgd, bg);
      cctx.putImageData(imgd, 0, 0);
    }
    function removeBackgroundHalo(imgd: ImageData, bg: { r: number; g: number; b: number }) {
      const w = imgd.width,
        h = imgd.height,
        d = imgd.data;
      const src = d.slice();
      const tol = 46;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (src[i + 3] === 0) continue;
          let edge = false;
          for (const [dx, dy] of dirs) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || src[(ny * w + nx) * 4 + 3] === 0) {
              edge = true;
              break;
            }
          }
          if (!edge) continue;
          if (src[i + 3] < 235 || dist(src[i], src[i + 1], src[i + 2], bg) < tol) d[i + 3] = 0;
        }
      }
    }
    function isProtected(r: number, g: number, b: number) {
      if (!protectEnabled || !protectedColors.length) return false;
      const tol = Number(($("protectTol") as HTMLInputElement).value);
      return protectedColors.some((c) => dist(r, g, b, c) <= tol);
    }
    function adjust(canvas: HTMLCanvasElement) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height),
        d = imgd.data;
      const baseSat = Number(($("saturation") as HTMLInputElement).value) / 100;
      const sb = mode === "color" ? Math.max(1, baseSat * 0.96) : mode === "light" ? baseSat * 1.04 : baseSat;
      const con = Number(($("contrast") as HTMLInputElement).value),
        cf = (259 * (con + 255)) / (255 * (259 - con));
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const gr = (r + g + b) / 3;
        const S = sat(r, g, b);
        const vibrance = mode === "color" && S > 0.55 ? 0.98 : S < 0.5 ? 1.08 : 1.0;
        r = gr + (r - gr) * sb * vibrance;
        g = gr + (g - gr) * sb * vibrance;
        b = gr + (b - gr) * sb * vibrance;
        const cf2 = mode === "color" ? 1 + (cf - 1) * 0.55 : cf;
        r = cf2 * (r - 128) + 128;
        g = cf2 * (g - 128) + 128;
        b = cf2 * (b - 128) + 128;
        d[i] = clamp(r, 0, 255);
        d[i + 1] = clamp(g, 0, 255);
        d[i + 2] = clamp(b, 0, 255);
      }
      ctx.putImageData(imgd, 0, 0);
    }
    function applyLevels(v: number) {
      const black = Number(($("blackPoint") as HTMLInputElement).value);
      const white = Math.max(black + 1, Number(($("whitePoint") as HTMLInputElement).value));
      const gammaVal = Math.max(0.1, Number(($("gamma") as HTMLInputElement).value));
      let t = clamp((v - black) / (white - black), 0, 1);
      t = Math.pow(t, 1 / gammaVal);
      return t * 255;
    }
    function drawDot(ctx2: CanvasRenderingContext2D, px: number, py: number, radius: number) {
      if (radius <= 0) return;
      ctx2.beginPath();
      ctx2.arc(px, py, radius, 0, Math.PI * 2);
      ctx2.fill();
    }
    function cellHash(x: number, y: number) {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967295;
    }
    function drawShape(ctx2: CanvasRenderingContext2D, shape: ScreenShape, px: number, py: number, radius: number, cellSize: number, rotAngle: number) {
      if (radius <= 0) return;
      if (shape === "round") {
        drawDot(ctx2, px, py, radius);
        return;
      }
      ctx2.save();
      ctx2.translate(px, py);
      ctx2.rotate(rotAngle);
      if (shape === "square" || shape === "diamond") {
        const side = radius * 1.772;
        if (shape === "diamond") ctx2.rotate(Math.PI / 4);
        ctx2.fillRect(-side / 2, -side / 2, side, side);
      } else if (shape === "ellipse") {
        const rx = radius * 1.35;
        const ry = radius * 0.72;
        ctx2.beginPath();
        ctx2.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx2.fill();
      } else if (shape === "line") {
        const barHeight = Math.max(0.4, radius * 1.6);
        ctx2.fillRect(-cellSize / 2, -barHeight / 2, cellSize, barHeight);
      } else if (shape === "rosette") {
        const sub = Math.max(0.3, radius * 0.5);
        const spread = Math.min(cellSize * 0.28, radius * 0.9 + 0.6);
        const offsetsDeg = [0, 45, 90, 135];
        for (const deg of offsetsDeg) {
          const rad = (deg * Math.PI) / 180;
          const ox = Math.cos(rad) * spread;
          const oy = Math.sin(rad) * spread;
          ctx2.beginPath();
          ctx2.arc(ox, oy, sub, 0, Math.PI * 2);
          ctx2.fill();
        }
      }
      ctx2.restore();
    }
    function hardenAlpha(canvas: HTMLCanvasElement) {
      const hctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const imgd = hctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgd.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        let na;
        if (a <= 18) na = 0;
        else if (a >= 238) na = 255;
        else {
          const t = (a - 18) / 220;
          na = clamp(Math.round(Math.pow(t, 0.78) * 255), 0, 255);
        }
        d[i + 3] = na;
      }
      hctx.putImageData(imgd, 0, 0);
    }
    function binarizeAlpha(canvas: HTMLCanvasElement, threshold = 128) {
      const bctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const imgd = bctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgd.data;
      for (let i = 3; i < d.length; i += 4) {
        d[i] = d[i] >= threshold ? 255 : 0;
      }
      bctx.putImageData(imgd, 0, 0);
    }
    function crc32(buf: Uint8Array) {
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      return (crc ^ 0xffffffff) >>> 0;
    }
    async function embedPngDpi(blob: Blob, dpiValue: number): Promise<Blob> {
      // Canvas-exported PNGs carry no resolution metadata, so other apps assume a default DPI
      // (72/96) and show the wrong physical size; embed a pHYs chunk with the real DPI.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const ihdrEnd = 8 + 4 + 4 + 13 + 4;
      const pixelsPerMeter = Math.round(dpiValue / 0.0254);
      const chunkBody = new Uint8Array(13);
      chunkBody.set([0x70, 0x48, 0x59, 0x73], 0);
      const bodyView = new DataView(chunkBody.buffer);
      bodyView.setUint32(4, pixelsPerMeter);
      bodyView.setUint32(8, pixelsPerMeter);
      chunkBody[12] = 1;
      const chunk = new Uint8Array(4 + chunkBody.length + 4);
      const chunkView = new DataView(chunk.buffer);
      chunkView.setUint32(0, 9);
      chunk.set(chunkBody, 4);
      chunkView.setUint32(4 + chunkBody.length, crc32(chunkBody));
      const out = new Uint8Array(bytes.length + chunk.length);
      out.set(bytes.subarray(0, ihdrEnd), 0);
      out.set(chunk, ihdrEnd);
      out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
      return new Blob([out], { type: "image/png" });
    }
    function cleanupResultResidualDust() {
      const power = Number(($("bgPower") as HTMLInputElement | null)?.value || 0);
      if (power < 90) return;
      const w = result.width,
        h = result.height;
      const imgd = rctx.getImageData(0, 0, w, h),
        d = imgd.data;
      const bg = sampledBgColor || sampleBorder() || { r: 0, g: 0, b: 0 };
      const localPower = Math.min(200, power + 18);
      const localTol = Number(($("colorTol") as HTMLInputElement | null)?.value || 48);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        if (!residualBgCandidate(d[i], d[i + 1], d[i + 2], d[i + 3], bg, mode, localPower)) continue;
        const L = lum(d[i], d[i + 1], d[i + 2]),
          S = sat(d[i], d[i + 1], d[i + 2]),
          mx = Math.max(d[i], d[i + 1], d[i + 2]);
        const bgDist = dist(d[i], d[i + 1], d[i + 2], bg || { r: 0, g: 0, b: 0 });
        let shouldRemove = false;
        if (mode === "dark") shouldRemove = power >= 150 || L < 125 || mx < 155;
        else if (mode === "light") shouldRemove = power >= 150 || L > 196 || (S < 0.2 && L > 182) || bgDist < 34;
        else shouldRemove = power >= 150 || bgDist < localTol + 18 || (S < 0.16 && bgDist < localTol + 28);
        if (shouldRemove) d[i + 3] = 0;
      }
      rctx.putImageData(imgd, 0, 0);
    }

    function restoreProtected() {
      if (!protectEnabled || !protectedColors.length) return;
      const w = clean.width,
        h = clean.height;
      const cleanData = cctx.getImageData(0, 0, w, h);
      const out = rctx.getImageData(0, 0, w, h);
      const cd = cleanData.data,
        od = out.data;
      for (let i = 0; i < cd.length; i += 4) {
        if (cd[i + 3] && isProtected(cd[i], cd[i + 1], cd[i + 2])) {
          od[i] = cd[i];
          od[i + 1] = cd[i + 1];
          od[i + 2] = cd[i + 2];
          od[i + 3] = cd[i + 3];
        }
      }
      rctx.putImageData(out, 0, 0);
    }
    // Sliding-window box blur (O(w*h) per pass) used to build a smooth alpha falloff grid.
    function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
      if (horizontal) {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          let sum = 0,
            count = 0;
          for (let x = 0; x <= Math.min(r, w - 1); x++) {
            sum += src[row + x];
            count++;
          }
          for (let x = 0; x < w; x++) {
            dst[row + x] = sum / count;
            const addX = x + r + 1,
              remX = x - r;
            if (addX < w) {
              sum += src[row + addX];
              count++;
            }
            if (remX >= 0) {
              sum -= src[row + remX];
              count--;
            }
          }
        }
      } else {
        for (let x = 0; x < w; x++) {
          let sum = 0,
            count = 0;
          for (let y = 0; y <= Math.min(r, h - 1); y++) {
            sum += src[y * w + x];
            count++;
          }
          for (let y = 0; y < h; y++) {
            dst[y * w + x] = sum / count;
            const addY = y + r + 1,
              remY = y - r;
            if (addY < h) {
              sum += src[addY * w + x];
              count++;
            }
            if (remY >= 0) {
              sum -= src[remY * w + x];
              count--;
            }
          }
        }
      }
    }
    // Builds a low-res, smoothly blurred alpha map so dots taper gradually near the artwork's
    // silhouette edge (small near the border, growing towards the interior) instead of being
    // clipped abruptly by the hard alpha mask.
    function buildEdgeFeatherGrid(pixelAlpha: Uint8ClampedArray, w: number, h: number, cellPx: number) {
      const ds = Math.max(2, Math.round(cellPx / 2));
      const gw = Math.ceil(w / ds),
        gh = Math.ceil(h / ds);
      const grid = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const sx = Math.min(w - 1, gx * ds + (ds >> 1)),
            sy = Math.min(h - 1, gy * ds + (ds >> 1));
          grid[gy * gw + gx] = pixelAlpha[(sy * w + sx) * 4 + 3] > 8 ? 1 : 0;
        }
      }
      const tmp = new Float32Array(gw * gh);
      const r = 3;
      boxBlurPass(grid, tmp, gw, gh, r, true);
      boxBlurPass(tmp, grid, gw, gh, r, false);
      return { grid, gw, gh, ds };
    }
    function sampleEdgeFeather(feather: { grid: Float32Array; gw: number; gh: number; ds: number }, x: number, y: number) {
      const gx = clamp(Math.floor(x / feather.ds), 0, feather.gw - 1),
        gy = clamp(Math.floor(y / feather.ds), 0, feather.gh - 1);
      return feather.grid[gy * feather.gw + gx];
    }
    function halftone() {
      const w = clean.width,
        h = clean.height;
      const lpiVal = Number(($("lpi") as HTMLInputElement).value);
      const cell = Math.max(1.1, dpi / lpiVal);
      const gain = Number(($("gain") as HTMLInputElement).value);
      const dotGain = Number(($("dotGain") as HTMLInputElement)?.value || 0) / 100;
      const blackProtect = 0.92;
      const angleDeg = Number(($("screenAngle") as HTMLInputElement).value);
      const angle = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(angle),
        sin = Math.sin(angle),
        cx = w / 2,
        cy = h / 2,
        diag = Math.ceil(Math.hypot(w, h));
      const cols = Math.ceil(diag / cell) + 4,
        rows = Math.ceil(diag / cell) + 4;
      const src = cctx.getImageData(0, 0, w, h).data;
      const edgeFeather = buildEdgeFeatherGrid(src, w, h, cell);

      // Supersampled (4x) anti-aliased dot tiles, cached per shape + quantized radius bucket.
      // Rendering a fresh 4x tile and downscaling it per dot is far too slow for large/fine
      // halftones (hundreds of thousands of cells), so we pre-render a small set of AA'd tiles
      // once and reuse them; per-dot cost becomes a cheap same-size translation draw.
      const SS = 4;
      const tileNative = Math.max(8, Math.ceil((cell * 1.3 + 2) * 2));
      const ssMinRadius = cell * 0.12;
      const maxRadius = cell * 0.62;
      const bucketSteps = 48;
      const ssCanvas = document.createElement("canvas");
      ssCanvas.width = tileNative * SS;
      ssCanvas.height = tileNative * SS;
      const ssCtx = ssCanvas.getContext("2d")!;
      const tileCache = new Map<string, HTMLCanvasElement>();
      function getDotTile(shape: ScreenShape, radius: number): HTMLCanvasElement {
        const q = Math.max(1, Math.round((radius / maxRadius) * bucketSteps));
        const key = shape + "_" + q;
        let tile = tileCache.get(key);
        if (!tile) {
          const rq = (q / bucketSteps) * maxRadius;
          ssCtx.setTransform(1, 0, 0, 1, 0, 0);
          ssCtx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
          ssCtx.setTransform(SS, 0, 0, SS, ssCanvas.width / 2, ssCanvas.height / 2);
          drawShape(ssCtx, shape, 0, 0, rq, cell, angle);
          tile = document.createElement("canvas");
          tile.width = tileNative;
          tile.height = tileNative;
          const tileCtx = tile.getContext("2d")!;
          tileCtx.imageSmoothingEnabled = true;
          tileCtx.imageSmoothingQuality = "high";
          tileCtx.drawImage(ssCanvas, 0, 0, tileNative, tileNative);
          tileCache.set(key, tile);
        }
        return tile;
      }

      rctx.clearRect(0, 0, w, h);
      rctx.drawImage(clean, 0, 0);

      rctx.save();
      rctx.globalCompositeOperation = "destination-out";
      rctx.globalAlpha = 1;
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = "high";

      for (let yy = -rows / 2; yy < rows / 2; yy++) {
        for (let xx = -cols / 2; xx < cols / 2; xx++) {
          const rx = xx * cell,
            ry = yy * cell;
          const px = cx + rx * cos - ry * sin,
            py = cy + rx * sin + ry * cos;
          if (px < -cell || py < -cell || px > w + cell || py > h + cell) continue;
          const ix = clamp(Math.round(px), 0, w - 1),
            iy = clamp(Math.round(py), 0, h - 1),
            i = (iy * w + ix) * 4;
          const a = src[i + 3] / 255;
          if (a <= 0.02) continue;
          const r = src[i],
            g = src[i + 1],
            b = src[i + 2];
          if (isProtected(r, g, b)) continue;

          const rawL = lum(r, g, b);
          const L = applyLevels(rawL);
          let amount = 1 - L / 255;

          if (mode === "color" || mode === "light") {
            const darkFactor = clamp((92 - rawL) / 92, 0, 1);
            if (darkFactor > 0) amount *= Math.max(0.02, 1 - blackProtect * darkFactor);
          }
          amount = clamp(amount * gain, 0, 1) * a;
          // Dot gain: simulates ink spreading on film/fabric, peaking at midtones and fading to
          // zero at the extremes (0%/100%), exactly like real press dot gain.
          if (dotGain !== 0) amount = clamp(amount + dotGain * Math.sin(Math.PI * amount), 0, 1);
          const edgeFactor = sampleEdgeFeather(edgeFeather, ix, iy);
          const radius = cell * 0.62 * Math.sqrt(amount) * edgeFactor;
          if (radius < 0.18) continue;

          const shape = mixEnabled && cellHash(Math.round(xx * 2), Math.round(yy * 2)) < mixAmount / 100 ? mixScreenType : screenType;
          if (radius >= ssMinRadius) {
            const tile = getDotTile(shape, radius);
            rctx.drawImage(tile, px - tileNative / 2, py - tileNative / 2);
          } else {
            drawShape(rctx, shape, px, py, radius, cell, angle);
          }
        }
      }
      rctx.restore();

      hardenAlpha(result);

      cleanupResultResidualDust();
      cleanupResultColorSpill();
      cleanupResultColorContaminationGlobal();
      restoreProtected();
      adjust(result);
    }

    function buildHalftoneSettingsFromUI(): HalftoneSettings {
      return {
        ...DEFAULT_HALFTONE_SETTINGS,
        dpi,
        lpi: Number(($("lpi") as HTMLInputElement).value),
        angle: Number(($("screenAngle") as HTMLInputElement).value),
        algorithm,
        dotShape: screenType,
        gamma: Number(($("gamma") as HTMLInputElement).value),
        blackPoint: Number(($("blackPoint") as HTMLInputElement).value),
        whitePoint: Number(($("whitePoint") as HTMLInputElement).value),
        dotGain: Number(($("dotGain") as HTMLInputElement)?.value || 0) / 100,
        gain: Number(($("gain") as HTMLInputElement).value),
        whiteMode,
        whiteDensity,
        whiteChoke,
        whiteLpi,
        whiteAngle,
        whiteDotShape,
        whiteAlgorithm,
        whiteGamma,
      };
    }

    // Real AM/FM/Hybrid + White Underbase pipeline. Color layer is still generated by
    // "punching" dots out of the clean (bg-removed) art, exactly like the legacy pipeline,
    // so all the existing cleanup/color-spill/protect passes below keep working unchanged.
    // The white channel is a genuinely separate Float32Array-derived layer (never alpha).
    function halftonePro() {
      const w = clean.width,
        h = clean.height;
      if (!w || !h) return;
      const settings = buildHalftoneSettingsFromUI();
      const check = validateDpiLpi(settings.dpi, settings.lpi);
      if (!check.ok && check.message) setStatus(check.message);

      const imgd = cctx.getImageData(0, 0, w, h);
      const layers = runHalftoneEngine(imgd.data, w, h, settings, { isProtected });

      const colorCellPx = Math.max(1.1, settings.dpi / settings.lpi);
      const colorAngleRad = (settings.angle * Math.PI) / 180;
      const colorCanvas = renderColorLayer(clean, layers.colorDots, colorCellPx, colorAngleRad);
      rctx.clearRect(0, 0, w, h);
      rctx.drawImage(colorCanvas, 0, 0);

      if (settings.whiteMode !== "none") {
        const whiteCellPx = Math.max(1.1, settings.dpi / settings.whiteLpi);
        const whiteAngleRad = (settings.whiteAngle * Math.PI) / 180;
        whiteLayerCanvas = renderWhiteLayer(w, h, layers.whiteDots, layers.whiteSolidCoverage, whiteCellPx, whiteAngleRad);
      } else {
        whiteLayerCanvas = null;
      }

      // No hardenAlpha() here on purpose: the pro pipeline keeps intermediate alpha as a
      // continuous 0..1 value (avoids premature binarization); export still binarizes at
      // the very end, matching the legacy engine's final output.
      cleanupResultResidualDust();
      cleanupResultColorSpill();
      cleanupResultColorContaminationGlobal();
      restoreProtected();
      adjust(result);
    }

    // --- PASSO 6G: Pro CMYK (RGBA -> buildPrintLayerSet -> PrintLayerSet -> composePrintPreview) ---
    // Independent from halftonePro()/halftone() above: never runs alongside them (process()
    // dispatches to exactly one engine), never calls separateRgbToCmyk() from the pro-rgb path,
    // and never touches am.ts/fm.ts/hybrid.ts/separation.ts/screening.ts/white.ts/choke.ts.
    function buildCmykChannelSettingsFromUI(key: CmykChannelKey): ChannelScreenSettings {
      const base = DEFAULT_CMYK_SCREEN_SETTINGS[key];
      return {
        ...base,
        lpi: Number(($(`${key}Lpi`) as HTMLInputElement)?.value || base.lpi),
        angle: Number(($(`${key}Angle`) as HTMLInputElement)?.value ?? base.angle),
        algorithm: cmykChannelAlgorithm(key),
      };
    }
    function buildPrintEngineSettingsFromUI(): PrintEngineSettings {
      return {
        dpi,
        color: DEFAULT_COLOR_SEPARATION_SETTINGS,
        cmyk: {
          cyan: buildCmykChannelSettingsFromUI("cyan"),
          magenta: buildCmykChannelSettingsFromUI("magenta"),
          yellow: buildCmykChannelSettingsFromUI("yellow"),
          black: buildCmykChannelSettingsFromUI("black"),
        },
        // Reuses the same White Underbase controls as the Pro RGB engine — never duplicated state.
        white: {
          whiteMode,
          whiteDensity,
          whiteChoke,
          whiteLpi,
          whiteAngle,
          whiteDotShape,
          whiteAlgorithm,
          whiteGamma,
          minDot: DEFAULT_HALFTONE_SETTINGS.minDot,
          maxDot: DEFAULT_HALFTONE_SETTINGS.maxDot,
          hybridThreshold: DEFAULT_HALFTONE_SETTINGS.hybridThreshold,
        },
      };
    }
    // Isolated single-channel diagnostic view (PASSO 6G section 19) — mirrors dtf/lab/lab.ts's
    // renderChannelPreview() but kept local so lab.ts's "never touches HalftoneStudio.tsx" stays true.
    function renderCmykChannelDiagnostic(layers: PrintLayerSet, channel: CmykChannelKey | "white"): RasterBuffer {
      const buffer: RasterBuffer = { data: new Uint8ClampedArray(layers.width * layers.height * 4), width: layers.width, height: layers.height };
      if (channel === "white") {
        if (layers.white.mode === "solid" && layers.white.coverage) paintCoverageGrid(buffer, layers.white.coverage, CHANNEL_COLORS.white);
        else if (layers.white.mode === "halftone" && layers.white.dots) paintDots(buffer, layers.white.dots, CHANNEL_COLORS.white);
        return buffer;
      }
      paintDots(buffer, layers[channel], CHANNEL_COLORS[channel]);
      return buffer;
    }
    // Redraws the cached PrintLayerSet into `result` for the selected diagnostic channel, without
    // recomputing buildPrintLayerSet() — keeps the Composto/C/M/Y/K/W toggle cheap.
    function renderCmykPreviewToResult() {
      if (!cmykLastLayers) return;
      const layers = cmykLastLayers;
      const buffer: RasterBuffer =
        cmykPreviewMode === "composite"
          ? composePrintPreview(layers, { background: [255, 255, 255, 255] })
          : renderCmykChannelDiagnostic(layers, cmykPreviewMode);
      const imgd = rctx.createImageData(layers.width, layers.height);
      imgd.data.set(buffer.data);
      rctx.clearRect(0, 0, result.width, result.height);
      rctx.putImageData(imgd, 0, 0);
    }
    function halftoneProCmyk() {
      const w = clean.width,
        h = clean.height;
      if (!w || !h) return;
      const settings = buildPrintEngineSettingsFromUI();
      const imgd = cctx.getImageData(0, 0, w, h);
      cmykLastLayers = buildPrintLayerSet(imgd.data, w, h, settings);
      whiteLayerCanvas = null; // Pro CMYK's White lives inside PrintLayerSet.white, not the Pro RGB whiteLayerCanvas.
      renderCmykPreviewToResult();
    }

    function render() {
      const composedPreview = !showBefore && engineMode === "pro" && previewMode !== "color" && whiteLayerCanvas ? composeDtfPreview(result, whiteLayerCanvas, previewMode) : null;
      const srcFull = showBefore ? original : composedPreview || result;
      $("badge").textContent = showBefore ? "Antes / original" : "Depois / resultado";
      let src: HTMLCanvasElement = srcFull;
      if (!showBefore && fillFrame && srcFull.width && srcFull.height) {
        const bounds = computeContentBounds(srcFull);
        if (bounds && (bounds.x > 0 || bounds.y > 0 || bounds.width !== srcFull.width || bounds.height !== srcFull.height)) {
          displayCrop.width = bounds.width;
          displayCrop.height = bounds.height;
          dctx.clearRect(0, 0, bounds.width, bounds.height);
          dctx.drawImage(srcFull, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
          src = displayCrop;
        }
      }
      viewCanvas.width = src.width;
      viewCanvas.height = src.height;
      vctx.clearRect(0, 0, src.width, src.height);
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(src, 0, 0);
      applyZoom();
    }
    function applyZoom() {
      labels();
      const wrap = $("canvasWrap");
      const scaledW = Math.max(1, Math.round(viewCanvas.width * zoom));
      const scaledH = Math.max(1, Math.round(viewCanvas.height * zoom));
      wrap.style.width = scaledW + "px";
      wrap.style.height = scaledH + "px";
      wrap.style.marginLeft = "0px";
      wrap.style.marginTop = "0px";
      wrap.style.transform = "none";
      viewCanvas.style.width = scaledW + "px";
      viewCanvas.style.height = scaledH + "px";
    }
    function fit() {
      if (!result.width) return;
      const v = $("viewer");
      const mobile = window.matchMedia("(max-width:920px)").matches;
      const safeSpace = mobile ? 40 : 92;
      const bounds = fillFrame ? computeContentBounds(result) : null;
      const dispW = bounds ? bounds.width : result.width;
      const dispH = bounds ? bounds.height : result.height;
      const z = Math.min((v.clientWidth - safeSpace) / dispW, (v.clientHeight - safeSpace) / dispH, 1);
      zoom = Math.max(0.05, z);
      ($("zoom") as HTMLInputElement).value = String(Math.round(zoom * 100));
      render();
      requestAnimationFrame(() => {
        v.scrollLeft = Math.max(0, (v.scrollWidth - v.clientWidth) / 2);
        v.scrollTop = Math.max(0, (v.scrollHeight - v.clientHeight) / 2);
      });
    }
    async function process() {
      if (!img) return;
      pickingBg = false;
      pickingProtect = false;
      const pickBgBtn = container.querySelector("#pickBgBtn");
      const pickProtect = container.querySelector("#pickProtect");
      if (pickBgBtn) pickBgBtn.classList.remove("on");
      if (pickProtect) pickProtect.classList.remove("on");
      updatePickCursor();
      labels();
      loading(true, "Processando...");
      setStatus("Processando halftone...");
      await new Promise((r) => setTimeout(r, 25));
      const [w, h] = targetSize();
      setCanv(w, h);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      octx.clearRect(0, 0, w, h);
      octx.drawImage(img, 0, 0, w, h);
      if (mode === "color" && !manualBgColor) detectBorderColor(false);
      removeBg();
      if (engineMode === "pro-cmyk") halftoneProCmyk();
      else if (engineMode === "pro") halftonePro();
      else halftone();
      showBefore = false;
      render();
      fit();
      $("empty").style.display = "none";
      const u = currentUnit();
      const lpiVal = Number(($("lpi") as HTMLInputElement).value);
      $("sizeInfo").textContent = `Saída: ${fmtUnit(pxToUnit(w, u, dpi), u)} × ${fmtUnit(pxToUnit(h, u, dpi), u)} • ${dpi} DPI • ${lpiVal} LPI`;
      setStatus("Pronto. Sua arte foi processada com sucesso.");
      loading(false);
    }
    function computeContentBounds(canvas: HTMLCanvasElement) {
      const w = canvas.width,
        h = canvas.height;
      if (!w || !h) return null;
      const boundsCtx = canvas.getContext("2d", { willReadFrequently: true })!;
      const data = boundsCtx.getImageData(0, 0, w, h).data;
      const ALPHA_THRESHOLD = 8;
      let top = -1,
        bottom = -1,
        left = -1,
        right = -1;
      for (let y = 0; y < h && top < 0; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            top = y;
            break;
          }
        }
      }
      if (top < 0) return null;
      for (let y = h - 1; y >= top && bottom < 0; y--) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            bottom = y;
            break;
          }
        }
      }
      for (let x = 0; x < w && left < 0; x++) {
        for (let y = top; y <= bottom; y++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            left = x;
            break;
          }
        }
      }
      for (let x = w - 1; x >= left && right < 0; x--) {
        for (let y = top; y <= bottom; y++) {
          if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
            right = x;
            break;
          }
        }
      }
      return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
    function downloadBytes(bytes: Uint8Array, name: string, mimeType: string) {
      const blob = new Blob([bytes.slice().buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
    async function saveCmykExport() {
      if (!cmykLastLayers) {
        setStatus("Gere o halftone Pro CMYK antes de baixar.");
        return;
      }
      const btn = $<HTMLButtonElement>("saveBtn");
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Gerando PNG final...";
      setStatus("Compondo White + CMYK + Alpha em PNG final 300 DPI...");
      try {
        const baseName = imgName.replace(/\.(png|jpg|jpeg|webp)$/i, "");
        const { filename, bytes } = exportFinalDtfPng(cmykLastLayers, baseName);
        downloadBytes(bytes, filename, "image/png");
        setStatus("Download iniciado (PNG final DTF, 300 DPI). Verifique a pasta de downloads.");
      } catch (err) {
        console.error(err);
        setStatus("Erro ao exportar PNG final DTF.");
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
    async function save() {
      if (engineMode === "pro-cmyk") {
        await saveCmykExport();
        return;
      }
      if (!result.width || !result.height) {
        setStatus("Gere o halftone antes de baixar.");
        return;
      }
      const btn = $<HTMLButtonElement>("saveBtn");
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Preparando PNG...";
      setStatus("Preparando arquivo para download...");
      const baseName = imgName.replace(/\.(png|jpg|jpeg|webp)$/i, "");
      const filename = baseName + `-halftone-dtf-${mode}.png`;
      try {
        const bounds = fillFrame ? computeContentBounds(result) : null;
        function cropTo(src: HTMLCanvasElement): HTMLCanvasElement {
          if (!bounds || (bounds.x === 0 && bounds.y === 0 && bounds.width === src.width && bounds.height === src.height)) return src;
          const cropped = document.createElement("canvas");
          cropped.width = bounds.width;
          cropped.height = bounds.height;
          const cropCtx = cropped.getContext("2d")!;
          cropCtx.imageSmoothingEnabled = false;
          cropCtx.drawImage(src, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
          return cropped;
        }
        // IMPORTANT: color and white are cropped with the exact same `bounds` so both files
        // stay pixel-registered with each other for print alignment on press.
        const exportCanvas = cropTo(result);
        binarizeAlpha(exportCanvas);
        const useWhiteExport = engineMode === "pro" && whiteMode !== "none" && !!whiteLayerCanvas;

        if (useWhiteExport) {
          const whiteExportCanvas = cropTo(whiteLayerCanvas!);
          const { colorBlob, colorFilename, whiteBlob, whiteFilename } = await exportDtfLayers(baseName + `-halftone-dtf-${mode}`, dpi, exportCanvas, whiteExportCanvas);
          const downloadBlob = (blob: Blob, name: string) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 15000);
          };
          downloadBlob(colorBlob, colorFilename);
          if (whiteBlob && whiteFilename) downloadBlob(whiteBlob, whiteFilename);
          setStatus("Download iniciado (arquivo de cor + branco). Verifique a pasta de downloads.");
          return;
        }

        let blob = await new Promise<Blob>((resolve, reject) => {
          exportCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar o PNG."))), "image/png", 1);
        });
        blob = await embedPngDpi(blob, dpi);
        const file = new File([blob], filename, { type: "image/png" });
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void> };
        if (isMobile && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: "Halftone Studio", text: "Sua arte em halftone está pronta." });
            setStatus("PNG gerado. Escolha onde salvar ou compartilhar.");
            return;
          } catch (err) {
            if (err && (err as { name?: string }).name === "AbortError") {
              setStatus("Download cancelado.");
              return;
            }
          }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        setStatus("Download iniciado. Verifique a pasta de downloads.");
      } catch (err) {
        console.error(err);
        setStatus("Não foi possível baixar. Tente novamente ou use outro navegador.");
        alert("Não foi possível gerar o PNG neste navegador. Tente novamente pelo Chrome ou use a opção de compartilhar/salvar do celular.");
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
    function drawSwatches() {
      const box = $("protectSwatches");
      box.innerHTML = "";
      protectedColors.forEach((c, idx) => {
        const el = document.createElement("div");
        el.className = "pswatch";
        el.style.background = hex(c);
        el.title = hex(c);
        const x = document.createElement("button");
        x.textContent = "×";
        x.onclick = () => {
          protectedColors.splice(idx, 1);
          drawSwatches();
          process();
        };
        el.appendChild(x);
        box.appendChild(el);
      });
    }
    function addProtect(c: { r: number; g: number; b: number }) {
      if (protectedColors.length >= 5) protectedColors.shift();
      protectedColors.push(c);
      drawSwatches();
      process();
    }
    function mapClickToPixel(e: MouseEvent) {
      const rect = viewCanvas.getBoundingClientRect();
      const x = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * viewCanvas.width), 0, viewCanvas.width - 1),
        y = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * viewCanvas.height), 0, viewCanvas.height - 1);
      const d = octx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    }
    function setCustomInputsFromPx(wPx: number, hPx: number) {
      const u = currentUnit();
      ($("customWidth") as HTMLInputElement).value = String(u === "px" ? Math.round(wPx) : Number(pxToUnit(wPx, u, dpi).toFixed(2)));
      ($("customHeight") as HTMLInputElement).value = String(u === "px" ? Math.round(hPx) : Number(pxToUnit(hPx, u, dpi).toFixed(2)));
    }
    function getCustomPx(): [number, number] {
      const u = currentUnit();
      return [Math.max(1, unitToPx(($("customWidth") as HTMLInputElement).value, u, dpi)), Math.max(1, unitToPx(($("customHeight") as HTMLInputElement).value, u, dpi))];
    }
    function updateFileMeta() {
      if (!img) return;
      const u = currentUnit();
      $("fileMeta").textContent = `Original: ${fmtUnit(pxToUnit(img.naturalWidth, u, dpi), u)} × ${fmtUnit(pxToUnit(img.naturalHeight, u, dpi), u)}`;
    }
    function syncWidth() {
      if (!img) return;
      if (lockRatio) {
        const w = Math.max(1, parseFloat(($("customWidth") as HTMLInputElement).value) || 1);
        ($("customHeight") as HTMLInputElement).value = currentUnit() === "px" ? String(Math.round(w / Math.max(aspectRatio, 0.0001))) : (w / Math.max(aspectRatio, 0.0001)).toFixed(2);
      }
      updateFileMeta();
      process();
    }
    function syncHeight() {
      if (!img) return;
      if (lockRatio) {
        const h = Math.max(1, parseFloat(($("customHeight") as HTMLInputElement).value) || 1);
        ($("customWidth") as HTMLInputElement).value = currentUnit() === "px" ? String(Math.round(h * Math.max(aspectRatio, 0.0001))) : (h * Math.max(aspectRatio, 0.0001)).toFixed(2);
      }
      updateFileMeta();
      process();
    }
    function changeUnit() {
      if (!img) {
        labels();
        return;
      }
      const [wPx, hPx] = getCustomPx();
      setCustomInputsFromPx(wPx, hPx);
      updateFileMeta();
      labels();
      process();
    }
    function setQuickHeightCm(cm: number) {
      if (!img) return;
      const hPx = unitToPx(cm, "cm", dpi);
      const wPx = lockRatio ? hPx * aspectRatio : getCustomPx()[0];
      setCustomInputsFromPx(wPx, hPx);
      updateFileMeta();
      process();
    }
    function restoreOriginalSize() {
      if (!img) return;
      setCustomInputsFromPx(img.naturalWidth, img.naturalHeight);
      updateFileMeta();
      process();
    }

    function collectPreset(): HalftonePreset {
      return {
        mode,
        screenType,
        mixEnabled,
        mixScreenType,
        mixAmount,
        lpi: Number(($("lpi") as HTMLInputElement).value),
        screenAngle: Number(($("screenAngle") as HTMLInputElement).value),
        blackPoint: Number(($("blackPoint") as HTMLInputElement).value),
        whitePoint: Number(($("whitePoint") as HTMLInputElement).value),
        gamma: Number(($("gamma") as HTMLInputElement).value),
        gain: Number(($("gain") as HTMLInputElement).value),
        dotGain: Number(($("dotGain") as HTMLInputElement).value),
        removePower: Number(($("removePower") as HTMLInputElement).value),
        bgPower: Number(($("bgPower") as HTMLInputElement).value),
        colorResidual: Number(($("colorResidual") as HTMLInputElement).value),
        saturation: Number(($("saturation") as HTMLInputElement).value),
        contrast: Number(($("contrast") as HTMLInputElement).value),
        protectTol: Number(($("protectTol") as HTMLInputElement).value),
        colorTol: Number(($("colorTol") as HTMLInputElement).value),
        dpi,
        fillFrame,
        removeHalo,
      };
    }
    function applyPreset(p: HalftonePreset) {
      mode = p.mode;
      container.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === p.mode));
      screenType = p.screenType;
      container.querySelectorAll<HTMLButtonElement>("#screenChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.screen === p.screenType));
      mixScreenType = p.mixScreenType;
      container.querySelectorAll<HTMLButtonElement>("#screenChips2 .chip").forEach((b) => b.classList.toggle("active", b.dataset.screen === p.mixScreenType));
      mixEnabled = p.mixEnabled;
      $("mixToggle").textContent = "Mesclar retículas: " + (mixEnabled ? "Ativado" : "Desativado");
      $("mixToggle").classList.toggle("hot", mixEnabled);
      $("mixWrap").style.display = mixEnabled ? "block" : "none";
      mixAmount = p.mixAmount;
      ($("mixAmount") as HTMLInputElement).value = String(p.mixAmount);
      ($("lpi") as HTMLInputElement).value = String(p.lpi);
      ($("screenAngle") as HTMLInputElement).value = String(p.screenAngle);
      ($("blackPoint") as HTMLInputElement).value = String(p.blackPoint);
      ($("whitePoint") as HTMLInputElement).value = String(p.whitePoint);
      ($("gamma") as HTMLInputElement).value = String(p.gamma);
      ($("gain") as HTMLInputElement).value = String(p.gain);
      ($("dotGain") as HTMLInputElement).value = String(p.dotGain ?? 0);
      ($("removePower") as HTMLInputElement).value = String(p.removePower);
      ($("bgPower") as HTMLInputElement).value = String(p.bgPower);
      ($("colorResidual") as HTMLInputElement).value = String(p.colorResidual);
      ($("saturation") as HTMLInputElement).value = String(p.saturation);
      ($("contrast") as HTMLInputElement).value = String(p.contrast);
      ($("protectTol") as HTMLInputElement).value = String(p.protectTol);
      ($("colorTol") as HTMLInputElement).value = String(p.colorTol);
      const beforePx = img ? getCustomPx() : null;
      container.querySelectorAll<HTMLButtonElement>("#dpiChips .chip").forEach((b) => b.classList.toggle("active", Number(b.dataset.dpi) === p.dpi));
      dpi = p.dpi;
      if (img && beforePx) setCustomInputsFromPx(beforePx[0], beforePx[1]);
      fillFrame = p.fillFrame;
      ($("fillFrame") as HTMLInputElement).checked = p.fillFrame;
      removeHalo = p.removeHalo;
      ($("removeHalo") as HTMLInputElement).checked = p.removeHalo;
      if (mode === "color" && !manualBgColor) detectBorderColor(false);
      updateFileMeta();
      labels();
      process();
    }
    function applyDtfProPreset(name: string) {
      const p: HalftoneSettings = resolvePreset(name);
      setEngineMode("pro");
      container.querySelectorAll("#engineChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.engine === "pro"));
      algorithm = p.algorithm;
      container.querySelectorAll("#algoChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.algo === p.algorithm));
      screenType = p.dotShape;
      container.querySelectorAll("#screenChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.screen === p.dotShape));
      ($("lpi") as HTMLInputElement).value = String(p.lpi);
      ($("screenAngle") as HTMLInputElement).value = String(p.angle);
      ($("gamma") as HTMLInputElement).value = String(p.gamma);
      ($("blackPoint") as HTMLInputElement).value = String(p.blackPoint);
      ($("whitePoint") as HTMLInputElement).value = String(p.whitePoint);
      ($("dotGain") as HTMLInputElement).value = String(Math.round(p.dotGain * 100));
      ($("gain") as HTMLInputElement).value = String(p.gain);

      whiteMode = p.whiteMode;
      container.querySelectorAll("#whiteModeChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.white === p.whiteMode));
      $("whiteWrap").style.display = whiteMode === "none" ? "none" : "block";
      $("whiteHalftoneWrap").style.display = whiteMode === "halftone" ? "block" : "none";
      whiteAlgorithm = p.whiteAlgorithm;
      container.querySelectorAll("#whiteAlgoChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.whitealgo === p.whiteAlgorithm));
      whiteDotShape = p.whiteDotShape;
      container.querySelectorAll("#whiteShapeChips .chip").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.whiteshape === p.whiteDotShape));
      whiteDensity = p.whiteDensity;
      ($("whiteDensity") as HTMLInputElement).value = String(Math.round(p.whiteDensity * 100));
      whiteChoke = p.whiteChoke;
      ($("whiteChoke") as HTMLInputElement).value = String(p.whiteChoke);
      whiteLpi = p.whiteLpi;
      ($("whiteLpi") as HTMLInputElement).value = String(p.whiteLpi);
      whiteAngle = p.whiteAngle;
      ($("whiteAngle") as HTMLInputElement).value = String(p.whiteAngle);
      whiteGamma = p.whiteGamma;
      ($("whiteGamma") as HTMLInputElement).value = String(p.whiteGamma);

      labels();
      process();
    }
    let presetCache: { id: string; name: string; data: HalftonePreset }[] = [];
    async function loadPresets() {
      try {
        const res = await fetch("/api/presets");
        if (!res.ok) return [];
        const json = await res.json();
        return (json.presets || []) as { id: string; name: string; data: HalftonePreset }[];
      } catch {
        return [];
      }
    }
    async function refreshPresetSelect() {
      const select = $<HTMLSelectElement>("presetSelect");
      presetCache = await loadPresets();
      const current = select.value;
      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = presetCache.length ? "Selecione um preset" : "Nenhum preset salvo";
      select.appendChild(placeholder);
      presetCache.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      if (presetCache.some((p) => p.name === current)) select.value = current;
    }
    refreshPresetSelect();
    $("savePresetBtn").addEventListener("click", async () => {
      const nameInput = $<HTMLInputElement>("presetName");
      const name = nameInput.value.trim();
      if (!name) {
        setStatus("Digite um nome para salvar o preset.");
        return;
      }
      try {
        const res = await fetch("/api/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, data: collectPreset() }),
        });
        if (!res.ok) throw new Error();
        await refreshPresetSelect();
        ($("presetSelect") as HTMLSelectElement).value = name;
        nameInput.value = "";
        setStatus(`Preset "${name}" salvo.`);
      } catch {
        setStatus("Erro ao salvar o preset.");
      }
    });
    $("applyPresetBtn").addEventListener("click", () => {
      const name = ($("presetSelect") as HTMLSelectElement).value;
      if (!name) {
        setStatus("Selecione um preset para aplicar.");
        return;
      }
      const preset = presetCache.find((p) => p.name === name);
      if (!preset) return;
      applyPreset(preset.data);
      setStatus(`Preset "${name}" aplicado.`);
    });
    $("deletePresetBtn").addEventListener("click", async () => {
      const select = $<HTMLSelectElement>("presetSelect");
      const name = select.value;
      if (!name) {
        setStatus("Selecione um preset para excluir.");
        return;
      }
      const preset = presetCache.find((p) => p.name === name);
      if (!preset) return;
      if (!window.confirm(`Excluir o preset "${name}"?`)) return;
      try {
        const res = await fetch(`/api/presets/${preset.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        await refreshPresetSelect();
        setStatus(`Preset "${name}" excluído.`);
      } catch {
        setStatus("Erro ao excluir o preset.");
      }
    });

    $("customWidth").addEventListener("input", syncWidth);
    $("customHeight").addEventListener("input", syncHeight);
    $("customWidth").addEventListener("change", syncWidth);
    $("customHeight").addEventListener("change", syncHeight);
    $("sizeUnit").addEventListener("change", changeUnit);

    const onFileInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const f = target.files?.[0];
      if (!f) return;
      loading(true, "Carregando imagem...");
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => {
        img = im;
        imgName = f.name;
        manualBgColor = false;
        aspectRatio = im.naturalWidth / Math.max(1, im.naturalHeight);
        $("fileName").textContent = f.name;
        setCustomInputsFromPx(im.naturalWidth, im.naturalHeight);
        updateFileMeta();
        URL.revokeObjectURL(url);
        process();
      };
      im.onerror = () => {
        loading(false);
        setStatus("Erro ao carregar imagem.");
      };
      im.src = url;
    };
    $("fileInput").addEventListener("change", onFileInput);

    container.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll(".mode").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        mode = b.dataset.mode as typeof mode;
        if (mode === "color" && !manualBgColor) detectBorderColor(false);
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#quickHeightChips .chip").forEach((b) =>
      b.addEventListener("click", () => setQuickHeightCm(Number(b.dataset.heightCm)))
    );
    $("restoreSizeBtn").addEventListener("click", restoreOriginalSize);
    $("lockRatio").addEventListener("change", () => {
      lockRatio = ($("lockRatio") as HTMLInputElement).checked;
    });
    $("fillFrame").addEventListener("change", () => {
      fillFrame = ($("fillFrame") as HTMLInputElement).checked;
      render();
      fit();
    });
    $("removeHalo").addEventListener("change", () => {
      removeHalo = ($("removeHalo") as HTMLInputElement).checked;
      process();
    });
    container.querySelectorAll<HTMLButtonElement>("#dpiChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        const beforePx = img ? getCustomPx() : null;
        container.querySelectorAll("#dpiChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        dpi = Number(b.dataset.dpi);
        if (img && beforePx) setCustomInputsFromPx(beforePx[0], beforePx[1]);
        updateFileMeta();
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#screenChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#screenChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        screenType = b.dataset.screen as ScreenShape;
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#screenChips2 .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#screenChips2 .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        mixScreenType = b.dataset.screen as ScreenShape;
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#engineChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#engineChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        setEngineMode(((b.dataset.engine as EngineMode) || "pro"));
        process();
      })
    );
    CMYK_CHANNELS.forEach(({ key }) => {
      const lpiEl = container.querySelector<HTMLInputElement>(`#${key}Lpi`);
      const angleEl = container.querySelector<HTMLInputElement>(`#${key}Angle`);
      [lpiEl, angleEl].forEach((el) => {
        if (!el) return;
        el.addEventListener("input", labels);
        el.addEventListener("change", process);
      });
      container.querySelectorAll<HTMLButtonElement>(`#${key}AlgoChips .chip`).forEach((b) =>
        b.addEventListener("click", () => {
          container.querySelectorAll(`#${key}AlgoChips .chip`).forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          const value = (b.dataset.algo as HalftoneAlgorithm) || "am";
          if (key === "cyan") cyanAlgorithm = value;
          else if (key === "magenta") magentaAlgorithm = value;
          else if (key === "yellow") yellowAlgorithm = value;
          else blackAlgorithm = value;
          updateCmykLpiAvailability();
          process();
        })
      );
    });
    container.querySelectorAll<HTMLButtonElement>("#cmykPreviewChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#cmykPreviewChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        cmykPreviewMode = (b.dataset.cmykpreview as CmykPreviewMode) || "composite";
        renderCmykPreviewToResult();
        render();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#algoChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#algoChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        algorithm = (b.dataset.algo as HalftoneAlgorithm) || "am";
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#whiteModeChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#whiteModeChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        whiteMode = (b.dataset.white as WhiteMode) || "none";
        $("whiteWrap").style.display = whiteMode === "none" ? "none" : "block";
        $("whiteHalftoneWrap").style.display = whiteMode === "halftone" ? "block" : "none";
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#whiteAlgoChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#whiteAlgoChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        whiteAlgorithm = (b.dataset.whitealgo as HalftoneAlgorithm) || "am";
        process();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#whiteShapeChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#whiteShapeChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        whiteDotShape = (b.dataset.whiteshape as ScreenShape) || "round";
        process();
      })
    );
    $("whiteDensity").addEventListener("input", () => {
      whiteDensity = Number(($("whiteDensity") as HTMLInputElement).value) / 100;
      labels();
    });
    $("whiteDensity").addEventListener("change", process);
    $("whiteChoke").addEventListener("input", () => {
      whiteChoke = Number(($("whiteChoke") as HTMLInputElement).value);
      labels();
    });
    $("whiteChoke").addEventListener("change", process);
    $("whiteLpi").addEventListener("input", () => {
      whiteLpi = Number(($("whiteLpi") as HTMLInputElement).value);
      labels();
    });
    $("whiteLpi").addEventListener("change", process);
    $("whiteAngle").addEventListener("input", () => {
      whiteAngle = Number(($("whiteAngle") as HTMLInputElement).value);
      labels();
    });
    $("whiteAngle").addEventListener("change", process);
    $("whiteGamma").addEventListener("input", () => {
      whiteGamma = Number(($("whiteGamma") as HTMLInputElement).value);
      labels();
    });
    $("whiteGamma").addEventListener("change", process);
    container.querySelectorAll<HTMLButtonElement>("#previewModeChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll("#previewModeChips .chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        previewMode = (b.dataset.preview as PreviewMode) || "color";
        render();
      })
    );
    container.querySelectorAll<HTMLButtonElement>("#dtfProPresetChips .chip").forEach((b) =>
      b.addEventListener("click", () => {
        const name = b.dataset.dtfpreset;
        if (name) applyDtfProPreset(name);
      })
    );    $("mixToggle").addEventListener("click", () => {
      mixEnabled = !mixEnabled;
      $("mixToggle").textContent = "Mesclar retículas: " + (mixEnabled ? "Ativado" : "Desativado");
      $("mixToggle").classList.toggle("hot", mixEnabled);
      $("mixWrap").style.display = mixEnabled ? "block" : "none";
      process();
    });
    $("mixAmount").addEventListener("input", () => {
      mixAmount = Number(($("mixAmount") as HTMLInputElement).value);
      labels();
    });
    $("mixAmount").addEventListener("change", process);
    ["gain", "dotGain", "removePower", "bgPower", "colorResidual", "saturation", "contrast", "protectTol", "colorTol", "lpi", "screenAngle", "blackPoint", "whitePoint", "gamma"].forEach((id) => {
      const el = container.querySelector<HTMLInputElement>("#" + id);
      if (!el) return;
      el.addEventListener("input", labels);
      el.addEventListener("change", process);
    });
    $("processBtn").addEventListener("click", process);
    $("saveBtn").addEventListener("click", save);
    $("fitBtn").addEventListener("click", fit);
    $("zoom").addEventListener("input", (e) => {
      zoom = Number((e.target as HTMLInputElement).value) / 100;
      applyZoom();
    });

    function zoomAtMouse(e: WheelEvent) {
      if (!result.width) return;
      e.preventDefault();
      const viewer = $("viewer");
      const viewerRect = viewer.getBoundingClientRect();
      const oldZoom = zoom;
      const localX = e.clientX - viewerRect.left;
      const localY = e.clientY - viewerRect.top;
      const contentX = viewer.scrollLeft + localX;
      const contentY = viewer.scrollTop + localY;
      const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clamp(zoom * delta, 0.05, 3);
      if (Math.abs(nextZoom - zoom) < 0.0001) return;
      const scale = nextZoom / Math.max(oldZoom, 0.0001);
      zoom = nextZoom;
      ($("zoom") as HTMLInputElement).value = String(Math.round(zoom * 100));
      applyZoom();
      requestAnimationFrame(() => {
        viewer.scrollLeft = contentX * scale - localX;
        viewer.scrollTop = contentY * scale - localY;
      });
    }
    $("viewer").addEventListener("wheel", zoomAtMouse, { passive: false });

    let isDraggingPreview = false;
    let dragStartX = 0,
      dragStartY = 0,
      dragScrollLeft = 0,
      dragScrollTop = 0,
      dragMoved = false;

    function canDragPreview(e: PointerEvent) {
      if (!result.width) return false;
      if (e.button !== 0) return false;
      if (pickingBg || pickingProtect) return false;
      if ((e.target as HTMLElement).closest("button,input,label,select")) return false;
      return true;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!canDragPreview(e)) return;
      isDraggingPreview = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragScrollLeft = $("viewer").scrollLeft;
      dragScrollTop = $("viewer").scrollTop;
      $("viewer").classList.add("dragging");
      $("viewer").setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingPreview) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
      const viewer = $("viewer");
      viewer.scrollLeft = dragScrollLeft - dx;
      viewer.scrollTop = dragScrollTop - dy;
    };
    const stopPreviewDrag = (e: PointerEvent) => {
      if (!isDraggingPreview) return;
      isDraggingPreview = false;
      $("viewer").classList.remove("dragging");
      try {
        $("viewer").releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    $("viewer").addEventListener("pointerdown", onPointerDown);
    $("viewer").addEventListener("pointermove", onPointerMove);
    $("viewer").addEventListener("pointerup", stopPreviewDrag);
    $("viewer").addEventListener("pointercancel", stopPreviewDrag);
    $("viewer").addEventListener("pointerleave", stopPreviewDrag);

    const beforeBtn = $("beforeBtn");
    const onBeforeDown = () => {
      if (!result.width) return;
      showBefore = true;
      render();
      beforeBtn.classList.add("active");
    };
    const onBeforeUp = () => {
      if (!result.width) return;
      showBefore = false;
      render();
      beforeBtn.classList.remove("active");
    };
    beforeBtn.addEventListener("pointerdown", onBeforeDown);
    ["pointerup", "pointercancel", "mouseleave"].forEach((ev) => beforeBtn.addEventListener(ev, onBeforeUp));

    container.querySelectorAll<HTMLButtonElement>(".bgbtn").forEach((b) =>
      b.addEventListener("click", () => {
        container.querySelectorAll(".bgbtn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        previewBg = b.dataset.bg as typeof previewBg;
        const w = $("canvasWrap");
        w.classList.remove("bg-black", "bg-white", "bg-custom");
        if (previewBg === "black") w.classList.add("bg-black");
        if (previewBg === "white") w.classList.add("bg-white");
        if (previewBg === "custom") {
          w.classList.add("bg-custom");
          $<HTMLInputElement>("customBg").click();
        }
      })
    );
    $<HTMLInputElement>("customBg").addEventListener("input", (e) => $("canvasWrap").style.setProperty("--custom-bg", (e.target as HTMLInputElement).value));
    $("detectBgBtn").addEventListener("click", () => {
      manualBgColor = false;
      detectBorderColor(false);
      setStatus("Cor da borda detectada: " + hex(sampledBgColor));
      if (mode === "color") process();
    });
    $("pickBgBtn").addEventListener("click", () => {
      pickingBg = !pickingBg;
      $("pickBgBtn").classList.toggle("on", pickingBg);
      updatePickCursor();
      if (pickingBg) {
        setStatus("Conta-gotas ativo: clique na cor do fundo.");
        showBefore = true;
        render();
      } else {
        showBefore = false;
        render();
      }
    });
    $("protectToggle").addEventListener("click", () => {
      protectEnabled = !protectEnabled;
      $("protectToggle").textContent = protectEnabled ? "Ativado" : "Desativado";
      $("protectToggle").classList.toggle("hot", protectEnabled);
      process();
    });
    $("pickProtect").addEventListener("click", () => {
      pickingBg = false;
      $("pickBgBtn").classList.remove("on");
      pickingProtect = !pickingProtect;
      $("pickProtect").classList.toggle("on", pickingProtect);
      updatePickCursor();
      setStatus(pickingProtect ? "Conta-gotas ativo: clique numa cor da imagem para manter lisa." : "Pronto.");
    });
    $("addWhite").addEventListener("click", () => addProtect({ r: 255, g: 255, b: 255 }));
    $("clearProtect").addEventListener("click", () => {
      protectedColors = [];
      drawSwatches();
      process();
    });
    const onCanvasClick = (e: MouseEvent) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      if (!img) return;
      const c = mapClickToPixel(e);
      if (pickingBg) {
        setBgColor(c, true);
        pickingBg = false;
        $("pickBgBtn").classList.remove("on");
        updatePickCursor();
        setStatus("Cor do fundo selecionada: " + hex(sampledBgColor));
        process();
        return;
      }
      if (!pickingProtect) return;
      addProtect(c);
      pickingProtect = false;
      $("pickProtect").classList.remove("on");
      updatePickCursor();
    };
    viewCanvas.addEventListener("click", onCanvasClick);

    const mobilePreviewJump = container.querySelector("#mobilePreviewJump");
    const onJumpClick = () => {
      $("viewer").scrollIntoView({ behavior: "smooth", block: "center" });
      if (result.width) setTimeout(fit, 260);
    };
    mobilePreviewJump?.addEventListener("click", onJumpClick);

    let resizeTimer = 0;
    function responsiveFit() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (result.width) fit();
      }, 140);
    }
    window.addEventListener("resize", responsiveFit);
    const onOrientation = () => setTimeout(responsiveFit, 220);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", responsiveFit);

    labels();
    updateCmykExportState();

    return () => {
      window.removeEventListener("resize", responsiveFit);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", responsiveFit);
    };
  }, []);

  return (
    <div className="hop-root" ref={rootRef}>
      <div className="hop-session-bar" aria-label="Sessão de acesso">
        <span>Acesso <b>liberado</b></span>
        <a href="/api/auth/logout">SAIR</a>
      </div>
      <div className="app">
        <aside id="sidePanel" className="side">
          <div className="brand">
            <div className="logo">
              <img src="/assets/favicon.png" alt="Halftone Studio" />
            </div>
            <div>
              <h1>Halftone Studio</h1>
              <div className="sub">crie halftone pronto para DTF em poucos cliques</div>
            </div>
          </div>
          <label className="drop" htmlFor="fileInput">
            <strong>Selecionar imagem</strong>
            <span>PNG, JPG ou WebP</span>
            <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <div className="filebox">
            <b id="fileName">Nenhuma imagem carregada</b>
            <span id="fileMeta">Carregue uma imagem para começar.</span>
          </div>

          <div className="section">
            <div className="sectionTitle">Presets DTF (Pro)</div>
            <div className="dica">
              <b>Dica:</b> aplica configurações prontas do motor Pro (algoritmo, LPI e White Underbase). Independente dos presets salvos abaixo.
            </div>
            <div className="chips" id="dtfProPresetChips">
              <button className="chip" data-dtfpreset="DTF Standard">
                Standard
              </button>
              <button className="chip" data-dtfpreset="DTF Detail">
                Detail
              </button>
              <button className="chip" data-dtfpreset="DTF Soft">
                Soft
              </button>
              <button className="chip" data-dtfpreset="DTF Strong">
                Strong
              </button>
              <button className="chip" data-dtfpreset="DTF White Solid">
                White Solid
              </button>
              <button className="chip" data-dtfpreset="DTF White Halftone">
                White Halftone
              </button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Presets</div>
            <div className="dica">
              <b>Dica:</b> salve as configurações atuais com um nome e aplique depois em qualquer outra imagem.
            </div>
            <div className="customField">
              <label>Nome do preset</label>
              <input id="presetName" type="text" placeholder="Ex: Camiseta preta 300dpi" />
            </div>
            <button id="savePresetBtn" className="smallBtn" type="button" style={{ width: "100%", marginTop: 8 }}>
              Salvar preset atual
            </button>
            <div className="customField" style={{ marginTop: 10 }}>
              <label>Presets salvos</label>
              <select id="presetSelect" className="unitSelect">
                <option value="">Nenhum preset salvo</option>
              </select>
            </div>
            <div className="protectTop" style={{ marginTop: 8 }}>
              <button id="applyPresetBtn" className="smallBtn" type="button" style={{ flex: 1 }}>
                Aplicar preset
              </button>
              <button id="deletePresetBtn" className="smallBtn warn" type="button" style={{ flex: 1 }}>
                Excluir preset
              </button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tipo de fundo</div>
            <div className="modes">
              <button className="mode active" data-mode="dark" title="Use quando o fundo da imagem é preto ou bem escuro.">
                Fundo escuro <span>ideal para artes em fundo preto</span>
              </button>
              <button className="mode" data-mode="color" title="Use quando o fundo tem uma cor forte, como amarelo, azul, vermelho ou verde.">
                Fundo colorido <span>remove a cor do fundo</span>
              </button>
              <button className="mode" data-mode="light" title="Use quando o fundo é branco, cinza claro ou quase branco.">
                Fundo claro <span>remove branco e cinza claro</span>
              </button>
            </div>
            <div className="dica">
              <b>Dica:</b> escolha o fundo mais parecido com a imagem para a limpeza ficar mais precisa.
            </div>
            <label className="checkRow">
              <input id="removeHalo" type="checkbox" />
              Remover halo da cor do fundo
            </label>
            <div className="dica">
              <b>Dica:</b> ativa uma limpeza extra na borda do recorte para tirar aquele contorno fino da cor do fundo que às vezes sobra.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tamanho da arte</div>
            <div className="customSizeBox">
              <div className="unitRow">
                <div className="customField">
                  <label>Unidade</label>
                  <select id="sizeUnit" className="unitSelect" defaultValue="cm">
                    <option value="cm">Centímetros</option>
                    <option value="mm">Milímetros</option>
                    <option value="px">Pixels</option>
                    <option value="in">Polegadas</option>
                  </select>
                </div>
              </div>
              <div className="customSizeRow">
                <div className="customField">
                  <label>Largura</label>
                  <input id="customWidth" type="number" min={1} step={0.1} defaultValue={20} />
                </div>
                <div className="customField">
                  <label>Altura</label>
                  <input id="customHeight" type="number" min={1} step={0.1} defaultValue={20} />
                </div>
              </div>
              <label className="checkRow">
                <input id="lockRatio" type="checkbox" defaultChecked />
                Travar proporção
              </label>
              <div className="miniText">
                <b>Dica:</b> largura e altura já vêm preenchidas com o tamanho do arquivo original. Com a proporção travada, mudar uma medida ajusta a outra automaticamente.
              </div>
              <div className="chips" id="quickHeightChips" style={{ marginTop: 10 }}>
                <button className="chip" data-height-cm="56" title="Define a altura em 56cm e calcula a largura proporcional.">
                  A2 · 56cm
                </button>
                <button className="chip" data-height-cm="40" title="Define a altura em 40cm e calcula a largura proporcional.">
                  A3 · 40cm
                </button>
                <button className="chip" data-height-cm="28" title="Define a altura em 28cm e calcula a largura proporcional.">
                  A4 · 28cm
                </button>
              </div>
              <button id="restoreSizeBtn" className="smallBtn" type="button" style={{ marginTop: 10, width: "100%" }}>
                Restaurar tamanho original
              </button>
              <label className="checkRow" style={{ marginTop: 10 }}>
                <input id="fillFrame" type="checkbox" defaultChecked />
                Preencher o quadro com a arte (sem sobra)
              </label>
              <div className="miniText">
                <b>Dica:</b> corta as bordas transparentes da arte para preencher todo o quadro escolhido, sem sobra de fundo.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Motor de halftone</div>
            <div className="dica">
              <b>Dica:</b> Pro usa retícula real AM/FM/Hybrid e White Underbase separado. Legado mantém o motor antigo como alternativa. Pro CMYK separa C/M/Y/K de forma independente (opcional).
            </div>
            <div className="chips" id="engineChips">
              <button className="chip active" data-engine="pro">
                Pro (novo)
              </button>
              <button className="chip" data-engine="legacy">
                Legado
              </button>
              <button className="chip" data-engine="pro-cmyk">
                Pro CMYK
              </button>
            </div>
          </div>

          <div className="section" id="proCmykSection" style={{ display: "none" }}>
            <div className="sectionTitle">Pro CMYK — pipeline</div>
            <div className="dica">
              <b>CMYK + White Underbase.</b> Preview CMYK — aproximação visual (não é uma simulação física da impressão/RIP).
            </div>
            {CMYK_CHANNELS.map(({ key, label }) => (
              <div key={key} style={{ marginTop: 12 }}>
                <div className="row">
                  <label>{label} — LPI</label>
                  <span className="val" id={`${key}LpiVal`}>{DEFAULT_CMYK_SCREEN_SETTINGS[key].lpi}</span>
                </div>
                <input id={`${key}Lpi`} type="range" min={10} max={85} defaultValue={DEFAULT_CMYK_SCREEN_SETTINGS[key].lpi} step={1} />
                <div className="dica" id={`${key}LpiFmNote`} style={{ display: "none" }}>
                  <b>FM ativo:</b> LPI não controla a densidade neste modo.
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label>{label} — Ângulo</label>
                  <span className="val" id={`${key}AngleVal`}>{DEFAULT_CMYK_SCREEN_SETTINGS[key].angle}°</span>
                </div>
                <input id={`${key}Angle`} type="range" min={0} max={90} defaultValue={DEFAULT_CMYK_SCREEN_SETTINGS[key].angle} step={0.5} />
                <div className="row" style={{ marginTop: 8 }}>
                  <label>{label} — Algoritmo</label>
                </div>
                <div className="chips" id={`${key}AlgoChips`}>
                  <button className="chip active" data-algo="am">AM</button>
                  <button className="chip" data-algo="fm">FM</button>
                  <button className="chip" data-algo="hybrid">Hybrid</button>
                </div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 14 }}>
              <label>Preview</label>
            </div>
            <div className="chips" id="cmykPreviewChips">
              <button className="chip active" data-cmykpreview="composite">Composto</button>
              <button className="chip" data-cmykpreview="cyan">C</button>
              <button className="chip" data-cmykpreview="magenta">M</button>
              <button className="chip" data-cmykpreview="yellow">Y</button>
              <button className="chip" data-cmykpreview="black">K</button>
              <button className="chip" data-cmykpreview="white">W</button>
            </div>
            <div className="dica" style={{ marginTop: 8 }}>
              <b>Exportação:</b> a exportação CMYK será habilitada na próxima etapa. White reutiliza os controles de White Underbase abaixo.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Algoritmo</div>
            <div className="dica">
              <b>Dica:</b> AM (amplitude) é a retícula clássica. FM (estocástica) preserva detalhe fino. Hybrid combina os dois.
            </div>
            <div className="chips" id="algoChips">
              <button className="chip active" data-algo="am">
                AM
              </button>
              <button className="chip" data-algo="fm">
                FM
              </button>
              <button className="chip" data-algo="hybrid">
                Hybrid
              </button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Qualidade da imagem</div>
            <div className="dica">
              <b>Dica:</b> 300 DPI já resolve a maioria dos trabalhos DTF. Use 600 ou 1200 para arquivos maiores e mais detalhados.
            </div>
            <div className="chips" id="dpiChips">
              <button className="chip active" data-dpi="300">
                300
              </button>
              <button className="chip" data-dpi="600">
                600
              </button>
              <button className="chip" data-dpi="1200">
                1200
              </button>
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Frequência (LPI)</label>
              <span className="val" id="lpiVal">32</span>
            </div>
            <input id="lpi" type="range" min={10} max={85} defaultValue={32} step={1} />
            <div className="dica">
              <b>Dica:</b> valores menores deixam os pontos maiores. Valores maiores deixam o halftone mais fino.
            </div>
            <div className="dica" id="lpiFmNote" style={{ display: "none" }}>
              <b>FM ativo:</b> o LPI não é utilizado neste modo — a densidade dos pontos é controlada pela matemática do FM (micro pitch), não por uma grade de frequência fixa.
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Ângulo</label>
              <span className="val" id="angleVal">22.5°</span>
            </div>
            <input id="screenAngle" type="range" min={0} max={90} defaultValue={22.5} step={0.5} />
            <div className="dica">
              <b>Dica:</b> gira a grade da retícula. 22,5° é o ângulo clássico usado na impressão.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tipo de retícula</div>
            <div className="dica">
              <b>Dica:</b> Round é o padrão para DTF. Diamond, Square, Elipse, Line e Rosette dão efeitos gráficos diferentes.
            </div>
            <div className="chips" id="screenChips">
              <button className="chip active" data-screen="round">
                Round (Photoshop)
              </button>
              <button className="chip" data-screen="diamond">
                Diamond
              </button>
              <button className="chip" data-screen="square">
                Square
              </button>
              <button className="chip" data-screen="ellipse">
                Elipse
              </button>
              <button className="chip" data-screen="line">
                Line
              </button>
              <button className="chip" data-screen="rosette">
                Rosette (Photoshop)
              </button>
            </div>
            <div className="protectTop" style={{ marginTop: 10 }}>
              <button id="mixToggle" className="smallBtn" title="Mescla dois tipos de retícula na mesma arte.">
                Mesclar retículas: Desativado
              </button>
            </div>
            <div id="mixWrap" style={{ display: "none", marginTop: 10 }}>
              <div className="chips" id="screenChips2">
                <button className="chip" data-screen="round">
                  Round (Photoshop)
                </button>
                <button className="chip" data-screen="diamond">
                  Diamond
                </button>
                <button className="chip" data-screen="square">
                  Square
                </button>
                <button className="chip" data-screen="ellipse">
                  Elipse
                </button>
                <button className="chip active" data-screen="line">
                  Line
                </button>
                <button className="chip" data-screen="rosette">
                  Rosette (Photoshop)
                </button>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Intensidade da mescla</label>
                <span className="val" id="mixVal">35</span>
              </div>
              <input id="mixAmount" type="range" min={0} max={100} defaultValue={35} step={1} />
              <div className="dica">
                <b>Dica:</b> controla a proporção entre a retícula principal e a secundária, célula a célula.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Tons do halftone</div>
            <div className="row">
              <label>Ponto preto</label>
              <span className="val" id="blackPointVal">16</span>
            </div>
            <input id="blackPoint" type="range" min={0} max={254} defaultValue={16} step={1} />
            <div className="row" style={{ marginTop: 10 }}>
              <label>Ponto branco</label>
              <span className="val" id="whitePointVal">110</span>
            </div>
            <input id="whitePoint" type="range" min={1} max={255} defaultValue={110} step={1} />
            <div className="row" style={{ marginTop: 10 }}>
              <label>Gamma</label>
              <span className="val" id="gammaVal">1.8</span>
            </div>
            <input id="gamma" type="range" min={0.1} max={3} defaultValue={1.8} step={0.1} />
            <div className="dica">
              <b>Dica:</b> ajusta como os tons da imagem viram pontos, do sombreado (preto) ao realce (branco), antes de aplicar o halftone.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">White Underbase</div>
            <div className="dica">
              <b>Dica:</b> gera a camada de tinta branca (base) separada da cor, para impressão DTF sobre tecidos escuros.
            </div>
            <div className="chips" id="whiteModeChips">
              <button className="chip active" data-white="none">
                Nenhum
              </button>
              <button className="chip" data-white="solid">
                Sólido
              </button>
              <button className="chip" data-white="halftone">
                Halftone
              </button>
            </div>
            <div id="whiteWrap" style={{ display: "none", marginTop: 10 }}>
              <div className="row">
                <label>Algoritmo do branco</label>
              </div>
              <div className="chips" id="whiteAlgoChips">
                <button className="chip active" data-whitealgo="am">
                  AM
                </button>
                <button className="chip" data-whitealgo="fm">
                  FM
                </button>
                <button className="chip" data-whitealgo="hybrid">
                  Hybrid
                </button>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Forma do ponto (branco)</label>
              </div>
              <div className="chips" id="whiteShapeChips">
                <button className="chip active" data-whiteshape="round">
                  Round
                </button>
                <button className="chip" data-whiteshape="ellipse">
                  Elipse
                </button>
                <button className="chip" data-whiteshape="line">
                  Line
                </button>
                <button className="chip" data-whiteshape="square">
                  Square
                </button>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Densidade</label>
                <span className="val" id="whiteDensityVal">100%</span>
              </div>
              <input id="whiteDensity" type="range" min={0} max={100} defaultValue={100} step={1} />
              <div className="row" style={{ marginTop: 10 }}>
                <label>Choke (contração)</label>
                <span className="val" id="whiteChokeVal">2px</span>
              </div>
              <input id="whiteChoke" type="range" min={0} max={20} defaultValue={2} step={0.5} />
              <div id="whiteHalftoneWrap" style={{ display: "none" }}>
                <div className="row" style={{ marginTop: 10 }}>
                  <label>Frequência do branco (LPI)</label>
                  <span className="val" id="whiteLpiVal">45</span>
                </div>
                <input id="whiteLpi" type="range" min={10} max={85} defaultValue={45} step={1} />
                <div className="dica" id="whiteLpiFmNote" style={{ display: "none" }}>
                  <b>FM ativo:</b> a Frequência (LPI) do branco não é utilizada neste modo — a densidade é controlada pela matemática do FM.
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <label>Ângulo do branco</label>
                  <span className="val" id="whiteAngleVal">67.5°</span>
                </div>
                <input id="whiteAngle" type="range" min={0} max={90} defaultValue={67.5} step={0.5} />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Gamma do branco</label>
                <span className="val" id="whiteGammaVal">1.00</span>
              </div>
              <input id="whiteGamma" type="range" min={0.3} max={3} defaultValue={1} step={0.05} />
              <div className="dica">
                <b>Dica:</b> o branco é um canal independente do alpha/cor. Choke encolhe geometricamente a base branca para evitar halo nas bordas.
              </div>
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Força do ponto</label>
              <span className="val" id="gainVal">1.00</span>
            </div>
            <input id="gain" type="range" min={0.55} max={1.8} defaultValue={1} step={0.05} />
            <div className="dica">
              <b>Dica:</b> aumente para deixar os pontos mais fortes. Diminua para um resultado mais suave.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Ganho de ponto (Dot Gain)</label>
              <span className="val" id="dotGainVal">0%</span>
            </div>
            <input id="dotGain" type="range" min={-40} max={40} defaultValue={0} step={1} />
            <div className="dica">
              <b>Dica:</b> simula a expansão da tinta no filme/tecido. Positivo faz os pontos crescerem nos meios-tons (compensa perda de detalhe na prensa). Negativo encolhe os pontos.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Limpeza da borda</label>
              <span className="val" id="removeVal">50</span>
            </div>
            <input id="removePower" type="range" min={5} max={110} defaultValue={50} step={1} />
            <div className="dica">
              <b>Dica:</b> limpa a borda externa da imagem. Use mais quando sobrar contorno do fundo.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Limpeza do fundo</label>
              <span className="val" id="bgPowerVal">0</span>
            </div>
            <input id="bgPower" type="range" min={0} max={200} defaultValue={0} step={1} />
            <div className="sub" style={{ marginTop: 6 }}>
              Aumenta a limpeza geral do fundo. Acima de 120 entra em limpeza agressiva para remover sujeira, resíduos e a própria cor do fundo que ainda sobra no resultado.
            </div>
          </div>
          <div className="section" id="colorResidualWrap">
            <div className="row">
              <label>Cor residual do fundo</label>
              <span className="val" id="colorResidualVal">80</span>
            </div>
            <input id="colorResidual" type="range" min={0} max={200} defaultValue={80} step={1} />
            <div className="sub" style={{ marginTop: 6 }}>
              Controle extra do modo Fundo colorido. Aumenta a remoção da cor que ainda sobra na arte depois de tirar o fundo.
            </div>
          </div>
          <div className="section" id="colorSection">
            <div className="sectionTitle">Cor do fundo</div>
            <div className="colorPickBox">
              <div id="bgColorSwatch" className="colorSwatch" />
              <div>
                <b id="bgColorText">#000000</b>
                <div className="miniText">Cor que será removida do fundo</div>
              </div>
            </div>
            <div className="protectTop">
              <button id="detectBgBtn" className="smallBtn hot" title="Detecta automaticamente a cor que está nas bordas da imagem.">
                Detectar cor
              </button>
              <button id="pickBgBtn" className="smallBtn" title="Clique e depois escolha manualmente a cor do fundo na imagem.">
                Escolher cor
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label>Variação da cor</label>
              <span className="val" id="colorTolVal">48</span>
            </div>
            <input id="colorTol" type="range" min={5} max={220} defaultValue={48} step={1} />
            <div className="miniText" style={{ marginTop: 7 }}>
              <b>Dica:</b> use “Detectar cor” para automático ou “Escolher cor” para clicar no fundo manualmente.
            </div>
          </div>

          <div className="section">
            <div className="row">
              <label>Saturação</label>
              <span className="val" id="satVal">132%</span>
            </div>
            <input id="saturation" type="range" min={80} max={220} defaultValue={132} step={2} />
            <div className="dica">
              <b>Dica:</b> aumenta ou reduz a força das cores antes de gerar o halftone.
            </div>
          </div>
          <div className="section">
            <div className="row">
              <label>Contraste</label>
              <span className="val" id="contrastVal">22</span>
            </div>
            <input id="contrast" type="range" min={-40} max={90} defaultValue={22} step={1} />
            <div className="dica">
              <b>Dica:</b> mais contraste deixa áreas claras e escuras mais separadas.
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Cores lisas</div>
            <div className="protectTop">
              <button id="protectToggle" className="smallBtn hot" title="Liga ou desliga a proteção das cores lisas.">
                Ativado
              </button>
              <button id="pickProtect" className="smallBtn" title="Escolha uma cor da imagem para ficar lisa, sem receber pontos de halftone.">
                Conta-gotas
              </button>
              <button id="addWhite" className="smallBtn" title="Mantém as partes brancas lisas, sem halftone.">
                Adicionar branco
              </button>
              <button id="clearProtect" className="smallBtn">
                Limpar cores
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label>Variação</label>
              <span className="val" id="protectTolVal">26</span>
            </div>
            <input id="protectTol" type="range" min={2} max={90} defaultValue={26} step={1} />
            <div className="swatches" id="protectSwatches" style={{ marginTop: 10 }} />
            <div className="dica">
              <b>Dica:</b> use para manter branco, preto ou outra cor lisa sem receber pontos.
            </div>
          </div>

          <div className="actions">
            <button id="processBtn" className="primary">Gerar halftone</button>
            <button id="saveBtn" className="secondary">Baixar PNG</button>
          </div>
        </aside>

        <main className="main">
          <div className="mainTop">
            <div>
              <div className="title">Prévia da arte</div>
              <div id="status" className="status">Carregue uma imagem.</div>
              <label className="mobileUpload" htmlFor="fileInput">
                <strong>Selecionar imagem</strong>
                <span>PNG, JPG ou WebP</span>
              </label>
            </div>
            <div className="toolbar">
              <div className="previewBg">
                <button className="bgbtn checker active" data-bg="checker" title="Transparente" />
                <button className="bgbtn black" data-bg="black" title="Preto" />
                <button className="bgbtn white" data-bg="white" title="Branco" />
                <button className="bgbtn custom" data-bg="custom" title="Personalizado" />
                <input id="customBg" type="color" defaultValue="#211136" />
              </div>
              <button id="beforeBtn" className="toolbtn">Ver antes</button>
              <div className="chips" id="previewModeChips">
                <button className="chip active" data-preview="color">
                  Cor
                </button>
                <button className="chip" data-preview="white">
                  Branco
                </button>
                <button className="chip" data-preview="composite">
                  Composto
                </button>
              </div>
              <button id="fitBtn" className="toolbtn">Ajustar</button>
              <div className="zoomBox">
                <label>Zoom</label>
                <input id="zoom" type="range" min={5} max={300} defaultValue={100} step={5} />
                <span id="zoomVal" className="val">100%</span>
              </div>
            </div>
          </div>
          <div id="viewer" className="viewer">
            <div className="stage">
              <div id="canvasWrap" className="canvasWrap">
                <div id="badge" className="badge">Depois / resultado</div>
                <canvas id="viewCanvas" />
                <div id="zoomBadge" className="zoomBadge">100%</div>
              </div>
            </div>
            <div id="empty" className="empty">Carregue uma imagem</div>
            <div id="stageLoading" className="stageLoading"><span>Processando...</span></div>
          </div>
          <div className="footer">
            <span id="sizeInfo">Sem imagem</span>
            <span className="hint">Preview = zoom • arraste para navegar • segure Ver antes</span>
          </div>
        </main>
      </div>
      <button id="mobilePreviewJump" className="mobilePreviewJump" type="button" aria-label="Ir para a prévia">
        ◉ Ver prévia
      </button>
    </div>
  );
}
