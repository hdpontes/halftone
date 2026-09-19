function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Canvas-exported PNGs carry no resolution metadata; embed a pHYs chunk with the real DPI. */
export async function embedPngDpi(blob: Blob, dpiValue: number): Promise<Blob> {
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

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar o PNG."))), "image/png", 1);
  });
}

export interface DtfExportResult {
  colorBlob: Blob;
  colorFilename: string;
  whiteBlob: Blob | null;
  whiteFilename: string | null;
}

/**
 * Produces the final export files at FULL RESOLUTION (never from a downscaled
 * preview canvas). Color is always exported; White is exported only when a
 * white layer canvas is provided (whiteMode !== "none").
 *
 * Note on format: two separate PNGs (`-color.png` / `-white.png`) is one
 * common convention, but which file(s) a given RIP/print software expects
 * varies — confirm with your RIP before assuming this is universally accepted.
 */
export async function exportDtfLayers(baseName: string, dpi: number, colorCanvas: HTMLCanvasElement, whiteCanvas: HTMLCanvasElement | null): Promise<DtfExportResult> {
  const colorBlob = await embedPngDpi(await canvasToPngBlob(colorCanvas), dpi);
  let whiteBlob: Blob | null = null;
  let whiteFilename: string | null = null;
  if (whiteCanvas) {
    whiteBlob = await embedPngDpi(await canvasToPngBlob(whiteCanvas), dpi);
    whiteFilename = `${baseName}-white.png`;
  }
  return { colorBlob, colorFilename: `${baseName}-color.png`, whiteBlob, whiteFilename };
}
