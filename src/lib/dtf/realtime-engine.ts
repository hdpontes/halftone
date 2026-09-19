import { buildPrintLayerSet } from "./engine";
import type { PrintEngineSettings, PrintLayerSet } from "./types";

export interface RealtimePrintEngine {
  readonly name: "wasm" | "js";
  buildLayerSet(data: Uint8ClampedArray, width: number, height: number, settings: PrintEngineSettings): PrintLayerSet;
}

interface WasmBridge {
  buildPrintLayerSet?: (data: Uint8ClampedArray, width: number, height: number, settings: PrintEngineSettings) => PrintLayerSet;
}

function readWasmBridge(): WasmBridge | null {
  if (typeof globalThis === "undefined") return null;
  const value = (globalThis as { __halftoneWasmBridge?: WasmBridge }).__halftoneWasmBridge;
  if (!value || typeof value.buildPrintLayerSet !== "function") return null;
  return value;
}

const jsEngine: RealtimePrintEngine = {
  name: "js",
  buildLayerSet(data, width, height, settings) {
    return buildPrintLayerSet(data, width, height, settings);
  },
};

const wasmEngine: RealtimePrintEngine = {
  name: "wasm",
  buildLayerSet(data, width, height, settings) {
    const bridge = readWasmBridge();
    if (!bridge?.buildPrintLayerSet) return jsEngine.buildLayerSet(data, width, height, settings);
    return bridge.buildPrintLayerSet(data, width, height, settings);
  },
};

export function resolveRealtimePrintEngine(): RealtimePrintEngine {
  return readWasmBridge() ? wasmEngine : jsEngine;
}
