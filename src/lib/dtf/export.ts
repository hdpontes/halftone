/**
 * PASSO 7A — DTF Pro CMYK exporter: individual PNG separations from a PrintLayerSet.
 * Canvas-free (plain typed arrays + dtf/png.ts), so it stays unit-testable via tsx like the
 * rest of the CMYK core, and works unmodified in the browser (no node:zlib/canvas dependency).
 *
 * Channel format (see PASSO 7A section 7): C/M/Y/K/White/Alpha are 8-bit GRAYSCALE PNGs where
 * 0 = no ink/transparent and 255 = full coverage/opaque — never a decorative RGB tint. Preview
 * is an RGBA PNG from composePrintPreview() and is explicitly NOT a RIP-ready color proof.
 *
 * Rasterizes the DotDescriptor[] actually produced by screening (never re-derives coverage
 * from the original RGB image), at the PrintLayerSet's own width/height — no per-channel crop
 * or bounding box, so every exported file shares the same dimensions/origin/DPI.
 */
import { pixelInsideDot, composePrintPreview, type RasterBuffer } from "./compose";
import { encodePng } from "./png";
import type { DotDescriptor } from "../halftone/types";
import type { PrintLayerSet } from "./types";

/** Fixed product requirement for this stage's ready-to-print PNG — deliberately not layers.dpi. */
export const FINAL_DTF_DPI = 300;

export interface DtfExportFile {
  filename: string;
  bytes: Uint8Array;
}

/**
 * FINAL OUTPUT rasterizer, not a UI preview: rasterizes the PrintLayerSet's actual White +
 * C/M/Y/K dots/coverage directly at layers.width x layers.height (never a downscaled/cropped
 * on-screen canvas capture). Reuses composePrintPreview()'s subtractive CMYK math — it already
 * computes straight from the layer data at full resolution, so the only difference here is
 * intent (deliverable vs. on-screen preview): background stays transparent so Alpha survives
 * untouched and is never painted over with White or baked in twice. This composite is still a
 * mathematical CMYK approximation (R=(1-C)(1-K) etc.), not an ICC/RIP color simulation.
 */
function renderFinalDtfComposite(layers: PrintLayerSet): RasterBuffer {
  return composePrintPreview(layers);
}

/**
 * Primary Pro CMYK export: a single ready-to-print `<baseName>_DTF.png`, composed from White +
 * C/M/Y/K dots + Alpha at the PrintLayerSet's own width/height (no crop, no resize), always
 * RGBA so existing artwork transparency is preserved. Embeds a fixed 300 DPI pHYs chunk (see
 * FINAL_DTF_DPI) regardless of layers.dpi, per this stage's fixed product requirement. The
 * halftone is already fully rasterized in this file — it does not need to be reprocessed by the
 * engine again, and it carries no ICC profile, printer calibration, RIP trapping, ink curve, or
 * fabric/substrate simulation.
 */
export function exportFinalDtfPng(layers: PrintLayerSet, baseName = "halftone"): DtfExportFile {
  const composite = renderFinalDtfComposite(layers);
  const bytes = encodePng(composite.data, layers.width, layers.height, 6, FINAL_DTF_DPI);
  return { filename: `${baseName}_DTF.png`, bytes };
}

export interface DtfExportOptions {
  includeCyan?: boolean;
  includeMagenta?: boolean;
  includeYellow?: boolean;
  includeBlack?: boolean;
  includeWhite?: boolean;
  includeAlpha?: boolean;
  includePreview?: boolean;
  /** File name stem, e.g. "halftone" -> "halftone_C.png". No timestamp is added by default. */
  baseName?: string;
}

const DEFAULT_DTF_EXPORT_OPTIONS: Required<DtfExportOptions> = {
  includeCyan: true,
  includeMagenta: true,
  includeYellow: true,
  includeBlack: true,
  includeWhite: true,
  includeAlpha: true,
  includePreview: true,
  baseName: "halftone",
};

export interface DtfExportResult {
  files: DtfExportFile[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0/255 grayscale presence mask for one channel's dots — same pixel-membership test used everywhere else in dtf/compose.ts. */
function renderChannelCoverage(width: number, height: number, dots: DotDescriptor[]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height); // starts at 0 = no ink
  for (const dot of dots) {
    const minX = Math.max(0, Math.floor(dot.x - dot.radius - 1));
    const maxX = Math.min(width - 1, Math.ceil(dot.x + dot.radius + 1));
    const minY = Math.max(0, Math.floor(dot.y - dot.radius - 1));
    const maxY = Math.min(height - 1, Math.ceil(dot.y + dot.radius + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pixelInsideDot(x + 0.5, y + 0.5, dot)) buf[y * width + x] = 255;
      }
    }
  }
  return buf;
}

/** White: "solid" reads WhiteLayer.coverage directly (never turned into dots), "halftone" rasterizes WhiteLayer.dots. */
function renderWhiteCoverage(layers: PrintLayerSet): Uint8ClampedArray | null {
  if (layers.white.mode === "none") return null;
  if (layers.white.mode === "solid" && layers.white.coverage) {
    const grid = layers.white.coverage;
    const buf = new Uint8ClampedArray(layers.width * layers.height);
    for (let y = 0; y < layers.height; y++) {
      const gy = Math.min(grid.height - 1, Math.floor(y / grid.cellPx));
      for (let x = 0; x < layers.width; x++) {
        const gx = Math.min(grid.width - 1, Math.floor(x / grid.cellPx));
        buf[y * layers.width + x] = Math.round(clamp01(grid.data[gy * grid.width + gx]) * 255);
      }
    }
    return buf;
  }
  if (layers.white.mode === "halftone" && layers.white.dots) {
    return renderChannelCoverage(layers.width, layers.height, layers.white.dots);
  }
  return null;
}

/** Raw art alpha (0..1) as-is: 0 = transparent, 255 = opaque. Never confused with White ink. */
function renderAlpha(layers: PrintLayerSet): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(layers.width * layers.height);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.round(clamp01(layers.alpha[i]) * 255);
  return buf;
}

/**
 * ADVANCED / DIAGNOSTIC export only — NOT the main user-facing flow (see exportFinalDtfPng for
 * that). Produces one grayscale/RGBA PNG per requested individual layer, all at layers.width x
 * layers.height, same origin, same layers.dpi (embedded as a pHYs chunk) — see module docstring
 * for format.
 */
export function exportDtfLayers(layers: PrintLayerSet, options: DtfExportOptions = {}): DtfExportResult {
  const opts = { ...DEFAULT_DTF_EXPORT_OPTIONS, ...options };
  const { width, height, dpi } = layers;
  const files: DtfExportFile[] = [];

  const pushGray = (suffix: string, gray: Uint8ClampedArray | null) => {
    if (!gray) return;
    files.push({ filename: `${opts.baseName}_${suffix}.png`, bytes: encodePng(gray, width, height, 0, dpi) });
  };

  if (opts.includeCyan) pushGray("C", renderChannelCoverage(width, height, layers.cyan));
  if (opts.includeMagenta) pushGray("M", renderChannelCoverage(width, height, layers.magenta));
  if (opts.includeYellow) pushGray("Y", renderChannelCoverage(width, height, layers.yellow));
  if (opts.includeBlack) pushGray("K", renderChannelCoverage(width, height, layers.black));
  if (opts.includeWhite) pushGray("W", renderWhiteCoverage(layers));
  if (opts.includeAlpha) pushGray("Alpha", renderAlpha(layers));

  if (opts.includePreview) {
    // PREVIEW ONLY — NOT A RIP-READY COLOR PROOF (visual approximation, see compose.ts).
    const preview = composePrintPreview(layers, { background: [255, 255, 255, 255] });
    files.push({ filename: `${opts.baseName}_Preview.png`, bytes: encodePng(preview.data, width, height, 6, dpi) });
  }

  return { files };
}
