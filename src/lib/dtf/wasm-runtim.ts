import type { PrintEngineSettings, PrintLayerSet } from "./types";

type WasmBridge = {
  buildPrintLayerSet: (data: Uint8ClampedArray, width: number, height: number, settings: PrintEngineSettings) => PrintLayerSet;
};

declare global {
  interface Window {
    __initHalftoneWasmBridge?: () => Promise<WasmBridge>;
    __halftoneWasmBridge?: WasmBridge;
  }
}

let initPromise: Promise<void> | null = null;

export function initRealtimeWasmBridge(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.__halftoneWasmBridge) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const bridge = await window.__initHalftoneWasmBridge?.();
      if (bridge) window.__halftoneWasmBridge = bridge;
    } catch {
      // Optional runtime enhancement only: JS engine fallback stays active.
    }
  })();

  return initPromise;
}
