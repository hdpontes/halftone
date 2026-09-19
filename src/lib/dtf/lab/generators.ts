/**
 * PASSO 6E — Test Lab: deterministic synthetic RGBA image generators.
 * Pure, canvas-free (plain Uint8ClampedArray), so every scenario is reproducible
 * across runs (needed for the determinism tests) and independent of any browser API.
 */

export interface LabImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function makeImage(width: number, height: number): LabImage {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

function setPixel(img: LabImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

export function fillRect(img: LabImage, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number, a = 255): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, r, g, b, a);
}

/** TESTE A/B/E — solid color swatch, fully opaque, uniform across the whole canvas. */
export function makeSolid(width: number, height: number, r: number, g: number, b: number, a = 255): LabImage {
  const img = makeImage(width, height);
  fillRect(img, 0, 0, width, height, r, g, b, a);
  return img;
}

/** Horizontal bands, one color per band — used for primaries/secondaries/neutrals/saturated tests. */
export function makeBands(width: number, height: number, colors: Array<[number, number, number, number?]>): LabImage {
  const img = makeImage(width, height);
  const bandH = Math.floor(height / colors.length);
  colors.forEach(([r, g, b, a], idx) => {
    fillRect(img, 0, idx * bandH, width, idx === colors.length - 1 ? height - idx * bandH : bandH, r, g, b, a ?? 255);
  });
  return img;
}

/** TESTE D — linear horizontal gradient from `from` to `to`, fully opaque. */
export function makeGradient(width: number, height: number, from: [number, number, number], to: [number, number, number]): LabImage {
  const img = makeImage(width, height);
  for (let x = 0; x < width; x++) {
    const t = width <= 1 ? 0 : x / (width - 1);
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    for (let y = 0; y < height; y++) setPixel(img, x, y, r, g, b, 255);
  }
  return img;
}

/** TESTE F — horizontal stripes (rows) of alpha 0/25/50/75/100%, constant RGB underneath. */
export function makeAlphaRamp(width: number, height: number, rgb: [number, number, number] = [200, 30, 30]): LabImage {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return makeBands(
    width,
    height,
    steps.map((t) => [rgb[0], rgb[1], rgb[2], Math.round(t * 255)])
  );
}

/** TESTE C — neutrals: white, 25/50/75% gray, black. */
export function makeNeutrals(width: number, height: number): LabImage {
  return makeBands(width, height, [
    [255, 255, 255],
    [191, 191, 191],
    [128, 128, 128],
    [64, 64, 64],
    [0, 0, 0],
  ]);
}

/** TESTE H — uniform coverage patch at a given gray level, used for angle/LPI/algorithm comparisons. */
export function makeUniformPatch(width: number, height: number, grayLevel = 128): LabImage {
  return makeSolid(width, height, grayLevel, grayLevel, grayLevel, 255);
}

/** TESTE 8 — isolated square "detail" marks of decreasing pixel size, spaced apart on transparent bg. */
export function makeSmallDetails(sizesPx: number[], gapPx = 12): LabImage {
  const totalW = sizesPx.reduce((sum, s) => sum + s + gapPx, gapPx);
  const maxH = Math.max(...sizesPx) + gapPx * 2;
  const img = makeImage(totalW, maxH);
  let x = gapPx;
  for (const size of sizesPx) {
    fillRect(img, x, Math.floor((maxH - size) / 2), size, size, 0, 0, 0, 255);
    x += size + gapPx;
  }
  return img;
}

// 5x7 bitmap font, just enough glyphs for the PASSO 6E text scenarios
// ("OVERPIXEL", "DTF", "HALFTONE PRO", "CMYK", "WHITE"). Not a general-purpose
// font — intentionally minimal, deterministic, and canvas-free.
const FONT_5X7: Record<string, string[]> = {
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** TESTE 9 — renders synthetic text using a minimal built-in 5x7 bitmap font, at a given pixel scale. */
export function makeText(text: string, scale = 4): LabImage {
  const glyphs = text.toUpperCase().split("");
  const glyphW = 5 * scale;
  const glyphH = 7 * scale;
  const gap = scale;
  const width = glyphs.length * (glyphW + gap) + gap;
  const height = glyphH + gap * 2;
  const img = makeImage(width, height);
  glyphs.forEach((ch, gi) => {
    const rows = FONT_5X7[ch] ?? FONT_5X7[" "];
    const ox = gap + gi * (glyphW + gap);
    rows.forEach((row, ry) => {
      row.split("").forEach((bit, rx) => {
        if (bit === "1") fillRect(img, ox + rx * scale, gap + ry * scale, scale, scale, 0, 0, 0, 255);
      });
    });
  });
  return img;
}
