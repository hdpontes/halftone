/**
 * PASSO 7A — dependency-free, canvas-free PNG encoder/decoder shared by the DTF exporter
 * (dtf/export.ts) and its tests. Runs identically in Node (tsx tests) and the browser (no
 * node:zlib, no canvas) because compression uses uncompressed ("stored") DEFLATE blocks —
 * bigger files than a real compressor, but a single code path everywhere and zero deps.
 *
 * Supports exactly the two color types this exporter needs:
 *   colorType 0 = grayscale, 1 byte/pixel (channel coverage / alpha separations)
 *   colorType 6 = RGBA, 4 bytes/pixel (composite preview)
 * decodePng() only understands PNGs produced by encodePng() below (single IDAT stream of
 * stored blocks, filter type 0 on every scanline) — it is a round-trip test utility, not a
 * general-purpose PNG decoder.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1,
    b = 0;
  const MOD = 65521;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32BE(out: Uint8Array, offset: number, value: number) {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}
function readUint32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(8 + data.length + 4);
  writeUint32BE(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeUint32BE(out, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return out;
}

/** Zlib stream using only uncompressed ("stored") DEFLATE blocks — no compression, no dependency. */
function zlibStoreNoCompression(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const MAX_BLOCK = 65535;
  let offset = 0;
  if (data.length === 0) {
    blocks.push(new Uint8Array([1, 0, 0, 0xff, 0xff]));
  }
  while (offset < data.length) {
    const len = Math.min(MAX_BLOCK, data.length - offset);
    const isFinal = offset + len >= data.length;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 1 : 0;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(concatBytes([header, data.subarray(offset, offset + len)]));
    offset += len;
  }
  const adler = new Uint8Array(4);
  writeUint32BE(adler, 0, adler32(data));
  return concatBytes([new Uint8Array([0x78, 0x01]), ...blocks, adler]);
}

/** Inverse of zlibStoreNoCompression(): reads back stored DEFLATE blocks only. */
function unzlibStoreNoCompression(zlibData: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 2; // skip 2-byte zlib header
  const end = zlibData.length - 4; // trailing adler32
  while (offset < end) {
    const isFinal = zlibData[offset] & 1;
    const len = zlibData[offset + 1] | (zlibData[offset + 2] << 8);
    offset += 5;
    parts.push(zlibData.subarray(offset, offset + len));
    offset += len;
    if (isFinal) break;
  }
  return concatBytes(parts);
}

export type PngColorType = 0 | 6; // 0 = grayscale, 6 = RGBA

/** Bytes per pixel for the color types this module supports. */
function bytesPerPixel(colorType: PngColorType): number {
  return colorType === 0 ? 1 : 4;
}

const PHYS_UNIT_METER = 1;

/**
 * Encodes raw pixel data (grayscale or RGBA, 8-bit) into PNG bytes, embedding a pHYs chunk
 * when `dpi` is provided (pixels-per-meter, same conversion as halftone/export.ts's
 * embedPngDpi: dpi / 0.0254). `pixels.length` must equal `width * height * bytesPerPixel(colorType)`.
 */
export function encodePng(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, colorType: PngColorType, dpi?: number): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, width);
  writeUint32BE(ihdrData, 4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = colorType;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = makeChunk("IHDR", ihdrData);

  const chunks: Uint8Array[] = [signature, ihdr];

  if (dpi && dpi > 0) {
    const pixelsPerMeter = Math.round(dpi / 0.0254);
    const physData = new Uint8Array(9);
    writeUint32BE(physData, 0, pixelsPerMeter);
    writeUint32BE(physData, 4, pixelsPerMeter);
    physData[8] = PHYS_UNIT_METER;
    chunks.push(makeChunk("pHYs", physData));
  }

  const bpp = bytesPerPixel(colorType);
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  chunks.push(makeChunk("IDAT", zlibStoreNoCompression(raw)));
  chunks.push(makeChunk("IEND", new Uint8Array(0)));

  return concatBytes(chunks);
}

export interface DecodedPng {
  width: number;
  height: number;
  colorType: PngColorType;
  dpi: number | null;
  pixels: Uint8ClampedArray;
}

/** Decodes PNGs produced by encodePng() above (see module docstring for the exact limitation). */
export function decodePng(buf: Uint8Array): DecodedPng {
  let offset = 8; // skip signature
  let width = 0,
    height = 0,
    colorType: PngColorType = 0,
    dpi: number | null = null;
  const idatParts: Uint8Array[] = [];
  while (offset < buf.length) {
    const length = readUint32BE(buf, offset);
    const type = new TextDecoder().decode(buf.subarray(offset + 4, offset + 8));
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32BE(data, 0);
      height = readUint32BE(data, 4);
      colorType = data[9] as PngColorType;
    } else if (type === "pHYs") {
      const pixelsPerMeter = readUint32BE(data, 0);
      dpi = Math.round(pixelsPerMeter * 0.0254);
    } else if (type === "IDAT") {
      idatParts.push(data);
    }
    offset += 8 + length + 4; // length + type + data + crc
  }
  const zlibData = concatBytes(idatParts);
  const raw = unzlibStoreNoCompression(zlibData);
  const bpp = bytesPerPixel(colorType);
  const stride = width * bpp;
  const pixels = new Uint8ClampedArray(width * height * bpp);
  for (let y = 0; y < height; y++) {
    pixels.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
  }
  return { width, height, colorType, dpi, pixels };
}
