/**
 * Testes do Color Separation Engine (PASSO 6A — RGB -> CMYK matemático).
 * Executar com: npx tsx src/lib/color/separation.test.ts
 * Sem framework de teste — cada `check()` lança um erro (processo sai com
 * código != 0) se a asserção falhar.
 */
import { DEFAULT_COLOR_SEPARATION_SETTINGS, separateRgbToCmyk, type ColorSeparationSettings } from "./separation";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function solidRgba(r: number, g: number, b: number, a = 255, w = 4, h = 4): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

function separateSolid(r: number, g: number, b: number, a = 255, overrides: Partial<ColorSeparationSettings> = {}) {
  const w = 2,
    h = 2;
  const data = solidRgba(r, g, b, a, w, h);
  const result = separateRgbToCmyk(data, w, h, overrides);
  return {
    c: result.channels.cyan[0],
    m: result.channels.magenta[0],
    y: result.channels.yellow[0],
    k: result.channels.black[0],
    a: result.alpha[0],
  };
}

// ---------------------------------------------------------------------------
// Cores primárias/secundárias/neutras (PASSO 6A seção 21)
// ---------------------------------------------------------------------------
{
  const white = separateSolid(255, 255, 255);
  check("WHITE: C=0", white.c === 0);
  check("WHITE: M=0", white.m === 0);
  check("WHITE: Y=0", white.y === 0);
  check("WHITE: K=0", white.k === 0);
}
{
  const black = separateSolid(0, 0, 0);
  check("BLACK: K alto (>0.5)", black.k > 0.5);
}
{
  const red = separateSolid(255, 0, 0);
  check("RED: C baixo", red.c < 0.05);
  check("RED: M alto", red.m > 0.9);
  check("RED: Y alto", red.y > 0.9);
  check("RED: K baixo", red.k < 0.05);
}
{
  const green = separateSolid(0, 255, 0);
  check("GREEN: C alto", green.c > 0.9);
  check("GREEN: M baixo", green.m < 0.05);
  check("GREEN: Y alto", green.y > 0.9);
  check("GREEN: K baixo", green.k < 0.05);
}
{
  const blue = separateSolid(0, 0, 255);
  check("BLUE: C alto", blue.c > 0.9);
  check("BLUE: M alto", blue.m > 0.9);
  check("BLUE: Y baixo", blue.y < 0.05);
  check("BLUE: K baixo", blue.k < 0.05);
}
{
  const cyan = separateSolid(0, 255, 255);
  check("CYAN: C alto", cyan.c > 0.9);
  check("CYAN: M baixo", cyan.m < 0.05);
  check("CYAN: Y baixo", cyan.y < 0.05);
  check("CYAN: K baixo", cyan.k < 0.05);
}
{
  const magenta = separateSolid(255, 0, 255);
  check("MAGENTA: M alto", magenta.m > 0.9);
  check("MAGENTA: C baixo", magenta.c < 0.05);
  check("MAGENTA: Y baixo", magenta.y < 0.05);
  check("MAGENTA: K baixo", magenta.k < 0.05);
}
{
  const yellow = separateSolid(255, 255, 0);
  check("YELLOW: Y alto", yellow.y > 0.9);
  check("YELLOW: C baixo", yellow.c < 0.05);
  check("YELLOW: M baixo", yellow.m < 0.05);
  check("YELLOW: K baixo", yellow.k < 0.05);
}

// ---------------------------------------------------------------------------
// Cinza neutro (seção 16)
// ---------------------------------------------------------------------------
for (const level of [0.25, 0.5, 0.75]) {
  const v = Math.round(level * 255);
  const gray = separateSolid(v, v, v);
  check(`GRAY ${level}: C≈M≈Y`, Math.abs(gray.c - gray.m) < 1e-4 && Math.abs(gray.m - gray.y) < 1e-4);
  check(`GRAY ${level}: nenhum canal negativo/-of-range`, [gray.c, gray.m, gray.y, gray.k].every((v2) => v2 >= 0 && v2 <= 1));
}

// ---------------------------------------------------------------------------
// GCR (seção 10, 22): gcrStrength 0..1 muda K e CMY em cinza médio
// ---------------------------------------------------------------------------
{
  const withoutGcr = separateSolid(128, 128, 128, 255, { gcrStrength: 0 });
  const withGcr = separateSolid(128, 128, 128, 255, { gcrStrength: 1 });
  check("GCR strength=0 -> K=0", withoutGcr.k === 0);
  check("GCR strength=1 -> K>0", withGcr.k > 0);
  check("GCR maior -> K aumenta", withGcr.k > withoutGcr.k);
  check("GCR maior -> CMY diminui", withGcr.c < withoutGcr.c);

  for (const gcrStrength of [0, 0.25, 0.5, 0.75, 1.0]) {
    const r = separateSolid(128, 128, 128, 255, { gcrStrength });
    check(`GCR strength=${gcrStrength} -> valores em 0..1`, r.c >= 0 && r.c <= 1 && r.k >= 0 && r.k <= 1);
  }
}

// ---------------------------------------------------------------------------
// UCR (seção 11, 23): atua principalmente em sombras/neutros escuros
// ---------------------------------------------------------------------------
{
  for (const ucrStrength of [0, 0.25, 0.5, 0.75, 1.0]) {
    const r = separateSolid(20, 20, 20, 255, { ucrStrength });
    check(`UCR strength=${ucrStrength} -> valores em 0..1`, r.c >= 0 && r.c <= 1 && r.k >= 0 && r.k <= 1);
  }
  const noUcr = separateSolid(20, 20, 20, 255, { ucrStrength: 0 });
  const fullUcr = separateSolid(20, 20, 20, 255, { ucrStrength: 1 });
  check("UCR strength 0 vs 1 -> resultados diferentes em sombra escura", Math.abs(noUcr.c - fullUcr.c) > 1e-3 || Math.abs(noUcr.k - fullUcr.k) > 1e-3);
  check("UCR maior -> mais K na sombra", fullUcr.k >= noUcr.k);
}

// ---------------------------------------------------------------------------
// TAC (seção 12, 13, 24)
// ---------------------------------------------------------------------------
{
  // Um cinza escuro tende a produzir alta cobertura total (C+M+Y+K somados);
  // usamos gcr/ucr fortes para maximizar K somado ao CMY residual.
  for (const maxTac of [4.0, 3.0, 2.5]) {
    const r = separateSolid(10, 10, 10, 255, { maxTac, gcrStrength: 1, ucrStrength: 1 });
    const total = r.c + r.m + r.y + r.k;
    check(`TAC maxTac=${maxTac} -> total <= maxTac (+tolerância)`, total <= maxTac + 1e-4);
  }
}

// ---------------------------------------------------------------------------
// Alpha (seção 17, 25): independente, nunca vira canal de tinta
// ---------------------------------------------------------------------------
{
  for (const aByte of [0, 64, 128, 191, 255]) {
    const r = separateSolid(200, 60, 60, aByte);
    if (aByte === 0) {
      check("alpha=0 -> C/M/Y/K todos 0", r.c === 0 && r.m === 0 && r.y === 0 && r.k === 0);
    }
    check(`alpha=${aByte} -> alpha channel preserva valor original`, Math.abs(r.a - aByte / 255) < 1e-4);
  }
  const full = separateSolid(200, 60, 60, 255);
  const half = separateSolid(200, 60, 60, 128);
  check("alpha=0.5 -> cobertura de tinta menor que alpha=1", half.c + half.m + half.y + half.k < full.c + full.m + full.y + full.k);
}

// ---------------------------------------------------------------------------
// Determinismo (seção 26)
// ---------------------------------------------------------------------------
{
  const w = 16,
    h = 16;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = (i * 13) % 256;
    data[i * 4 + 2] = (i * 29) % 256;
    data[i * 4 + 3] = 255;
  }
  const r1 = separateRgbToCmyk(data, w, h);
  const r2 = separateRgbToCmyk(data, w, h);
  let identical = true;
  for (let i = 0; i < w * h; i++) {
    if (
      r1.channels.cyan[i] !== r2.channels.cyan[i] ||
      r1.channels.magenta[i] !== r2.channels.magenta[i] ||
      r1.channels.yellow[i] !== r2.channels.yellow[i] ||
      r1.channels.black[i] !== r2.channels.black[i]
    ) {
      identical = false;
      break;
    }
  }
  check("determinismo: mesma entrada -> mesma saída", identical);
}

// ---------------------------------------------------------------------------
// Limites (seção 27): nenhum resultado escapa de 0..1
// ---------------------------------------------------------------------------
{
  const combos: Array<Partial<ColorSeparationSettings>> = [];
  for (const blackGeneration of [0, 1]) {
    for (const gcrStrength of [0, 1]) {
      for (const ucrStrength of [0, 1]) {
        for (const maxTac of [1, 2, 3, 4]) {
          combos.push({ blackGeneration, gcrStrength, ucrStrength, maxTac });
        }
      }
    }
  }
  const samples: Array<[number, number, number]> = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 128, 128],
    [10, 10, 10],
    [200, 60, 60],
  ];
  let allInRange = true;
  for (const overrides of combos) {
    for (const [r, g, b] of samples) {
      const res = separateSolid(r, g, b, 255, overrides);
      for (const v of [res.c, res.m, res.y, res.k]) {
        if (v < 0 || v > 1 || Number.isNaN(v)) allInRange = false;
      }
    }
  }
  check("limites: todas as combinações produzem canais em 0..1", allInRange);
}

// ---------------------------------------------------------------------------
// Cores saturadas (seção 14): preserveSaturatedColors evita K excessivo
// ---------------------------------------------------------------------------
{
  // Vermelho vivo mas não puro (ainda bastante saturado) — checa se K some.
  const withProtection = separateSolid(210, 40, 40, 255, { preserveSaturatedColors: true, gcrStrength: 1 });
  const withoutProtection = separateSolid(210, 40, 40, 255, { preserveSaturatedColors: false, gcrStrength: 1 });
  check("preserveSaturatedColors reduz K em cor saturada", withProtection.k <= withoutProtection.k);
}

// ---------------------------------------------------------------------------
// defaults seguros
// ---------------------------------------------------------------------------
{
  check("defaults: gcrStrength em 0..1", DEFAULT_COLOR_SEPARATION_SETTINGS.gcrStrength >= 0 && DEFAULT_COLOR_SEPARATION_SETTINGS.gcrStrength <= 1);
  check("defaults: ucrStrength em 0..1", DEFAULT_COLOR_SEPARATION_SETTINGS.ucrStrength >= 0 && DEFAULT_COLOR_SEPARATION_SETTINGS.ucrStrength <= 1);
  check("defaults: blackMax em 0..1", DEFAULT_COLOR_SEPARATION_SETTINGS.blackMax >= 0 && DEFAULT_COLOR_SEPARATION_SETTINGS.blackMax <= 1);
  check("defaults: maxTac razoável (>1, <=4)", DEFAULT_COLOR_SEPARATION_SETTINGS.maxTac > 1 && DEFAULT_COLOR_SEPARATION_SETTINGS.maxTac <= 4);
}

console.log(`\n${passed} testes passaram.`);
