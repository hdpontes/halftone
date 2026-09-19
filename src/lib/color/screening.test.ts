/**
 * Testes do Screening Independente C/M/Y/K (PASSO 6B).
 * Executar com: npx tsx src/lib/color/screening.test.ts
 * Sem framework de teste — cada `check()` lança um erro (processo sai com
 * código != 0) se a asserção falhar.
 */
import { screenChannel, screenCmykChannels, DEFAULT_CMYK_SCREEN_SETTINGS, type ChannelScreenSettings, type CmykScreenSettings } from "./screening";
import type { ColorChannels } from "./separation";

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FALHOU: ${name}`);
  passed++;
  console.log(`OK: ${name}`);
}

function solidChannel(width: number, height: number, value: number): Float32Array {
  return new Float32Array(width * height).fill(value);
}

function baseSettings(overrides: Partial<ChannelScreenSettings> = {}): ChannelScreenSettings {
  return { lpi: 45, angle: 15, gamma: 1, dotGain: 0, algorithm: "am", dotShape: "round", ...overrides };
}

function makeChannels(c: number, m: number, y: number, k: number, w: number, h: number): ColorChannels {
  return {
    cyan: solidChannel(w, h, c),
    magenta: solidChannel(w, h, m),
    yellow: solidChannel(w, h, y),
    black: solidChannel(w, h, k),
  };
}

const dpi = 300;

// ---------------------------------------------------------------------------
// Independência: canal com coverage 0 não gera pontos; canal com coverage 1 gera.
// ---------------------------------------------------------------------------
{
  const w = 100,
    h = 100;
  const channels = makeChannels(1, 0, 0, 0, w, h);
  const settings: CmykScreenSettings = {
    cyan: baseSettings(),
    magenta: baseSettings(),
    yellow: baseSettings(),
    black: baseSettings(),
  };
  const result = screenCmykChannels(channels, w, h, dpi, settings);
  check("independência: C=1,M=0 -> cyanDots > 0", result.cyanDots.length > 0);
  check("independência: C=1,M=0 -> magentaDots === 0", result.magentaDots.length === 0);
  check("independência: C=1,M=0 -> yellowDots === 0", result.yellowDots.length === 0);
  check("independência: C=1,M=0 -> blackDots === 0", result.blackDots.length === 0);
}
{
  const w = 100,
    h = 100;
  const channels = makeChannels(0, 1, 0, 0, w, h);
  const settings: CmykScreenSettings = {
    cyan: baseSettings(),
    magenta: baseSettings(),
    yellow: baseSettings(),
    black: baseSettings(),
  };
  const result = screenCmykChannels(channels, w, h, dpi, settings);
  check("independência invertida: C=0 -> cyanDots === 0", result.cyanDots.length === 0);
  check("independência invertida: M=1 -> magentaDots > 0", result.magentaDots.length > 0);
}

// ---------------------------------------------------------------------------
// Independência de configuração: mesmo coverage, ângulos diferentes -> geometria diferente.
// ---------------------------------------------------------------------------
{
  const w = 120,
    h = 120;
  const coverage = solidChannel(w, h, 0.5);
  const cDots = screenChannel(coverage, w, h, dpi, baseSettings({ angle: 15 }));
  const mDots = screenChannel(coverage, w, h, dpi, baseSettings({ angle: 75 }));
  check("ângulos diferentes -> mesma contagem de dots (só geometria muda)", cDots.length === mDots.length);
  const key = (d: { x: number; y: number }) => `${Math.round(d.x)}_${Math.round(d.y)}`;
  const cSet = new Set(cDots.map(key));
  const overlap = mDots.filter((d) => cSet.has(key(d))).length;
  check("ângulos diferentes (15 vs 75) -> posições majoritariamente diferentes", overlap < mDots.length * 0.5);
}

// ---------------------------------------------------------------------------
// Independência de algoritmo: cada canal usa seu próprio motor.
// ---------------------------------------------------------------------------
{
  const w = 150,
    h = 150;
  const channels = makeChannels(0.5, 0.5, 0.5, 0.5, w, h);
  const settings: CmykScreenSettings = {
    cyan: baseSettings({ algorithm: "am" }),
    magenta: baseSettings({ algorithm: "fm" }),
    yellow: baseSettings({ algorithm: "hybrid", hybridThreshold: 0.5, hybridBlendWidth: 0.1 }),
    black: baseSettings({ algorithm: "am" }),
  };
  const result = screenCmykChannels(channels, w, h, dpi, settings);
  check("algoritmo por canal: AM produz pontos", result.cyanDots.length > 0);
  check("algoritmo por canal: FM produz pontos", result.magentaDots.length > 0);
  check("algoritmo por canal: Hybrid produz pontos", result.yellowDots.length > 0);
  // FM tem grade micro geralmente mais numerosa que AM para a mesma coverage/lpi.
  check("algoritmo por canal: FM (magenta) tem mais posições que AM (cyan)", result.magentaDots.length > result.cyanDots.length);
}

// ---------------------------------------------------------------------------
// Independência de LPI (AM): LPI diferente -> estrutura espacial diferente.
// ---------------------------------------------------------------------------
{
  const w = 200,
    h = 200;
  const coverage = solidChannel(w, h, 0.4);
  const lowLpi = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "am", lpi: 20 }));
  const highLpi = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "am", lpi: 60 }));
  check("LPI maior (AM) -> mais pontos na mesma área", highLpi.length > lowLpi.length);
}
{
  // FM: LPI não controla densidade diretamente (motor atual é hash-based, pitch fixo).
  const w = 200,
    h = 200;
  const coverage = solidChannel(w, h, 0.4);
  const lowLpiFm = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "fm", lpi: 20 }));
  const highLpiFm = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "fm", lpi: 60 }));
  check("FM: LPI não é usado para densidade (contagens próximas)", Math.abs(lowLpiFm.length - highLpiFm.length) < Math.max(lowLpiFm.length, highLpiFm.length) * 0.05);
}

// ---------------------------------------------------------------------------
// Gamma: resposta tonal diferente altera a cobertura efetiva (raio dos pontos) antes do screening.
// AM mantém a mesma contagem de pontos para uma coverage uniforme (grade fixa) — o que muda é o raio.
// ---------------------------------------------------------------------------
{
  const w = 200,
    h = 200;
  for (const cov of [0.25, 0.5, 0.75]) {
    const coverage = solidChannel(w, h, cov);
    const lowGamma = screenChannel(coverage, w, h, dpi, baseSettings({ gamma: 0.5 }));
    const highGamma = screenChannel(coverage, w, h, dpi, baseSettings({ gamma: 2.5 }));
    check(`gamma diferente em coverage=${cov} -> raio médio diferente`, Math.abs(lowGamma[0].radius - highGamma[0].radius) > 1e-3);
  }
}

// ---------------------------------------------------------------------------
// Dot gain: dotGain=0 vs dotGain>0 produzem resultados diferentes, sem sair de 0..1.
// ---------------------------------------------------------------------------
{
  const w = 150,
    h = 150;
  const coverage = solidChannel(w, h, 0.3);
  const noGain = screenChannel(coverage, w, h, dpi, baseSettings({ dotGain: 0 }));
  const withGain = screenChannel(coverage, w, h, dpi, baseSettings({ dotGain: 0.3 }));
  check("dotGain=0 vs dotGain=0.3 -> dots diferentes", noGain.length !== withGain.length || noGain.some((d, i) => Math.abs(d.radius - withGain[i]?.radius) > 1e-6));
  check("dotGain>0 -> nenhum raio negativo/absurdo", withGain.every((d) => d.radius >= 0));
}

// ---------------------------------------------------------------------------
// Hybrid: threshold/blendWidth continuam com crossfade suave (sem regressão para hard cutoff).
// ---------------------------------------------------------------------------
{
  const w = 400,
    h = 20;
  // gradiente horizontal 0..1 no coverage array
  const coverage = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) coverage[y * w + x] = x / w;

  const hard = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "hybrid", hybridThreshold: 0.5, hybridBlendWidth: 0 }));
  const soft = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "hybrid", hybridThreshold: 0.5, hybridBlendWidth: 0.15 }));
  check("hybrid: blendWidth=0 ainda gera pontos (compat.)", hard.length > 0);
  check("hybrid: blendWidth=0.15 gera pontos", soft.length > 0);
  check("hybrid: blendWidth maior -> contagem total muda (crossfade em ação)", hard.length !== soft.length);
}

// ---------------------------------------------------------------------------
// Bounds: todos os raios/posições dentro de faixas plausíveis (nunca NaN, nunca negativo).
// ---------------------------------------------------------------------------
{
  const w = 100,
    h = 100;
  const coverage = solidChannel(w, h, 0.6);
  const dots = screenChannel(coverage, w, h, dpi, baseSettings({ algorithm: "am" }));
  check(
    "bounds: nenhum raio NaN/negativo",
    dots.every((d) => !Number.isNaN(d.radius) && d.radius >= 0 && !Number.isNaN(d.x) && !Number.isNaN(d.y))
  );
}

// ---------------------------------------------------------------------------
// Determinismo.
// ---------------------------------------------------------------------------
{
  const w = 80,
    h = 80;
  const coverage = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) coverage[i] = (i % 17) / 17;
  const settings = baseSettings({ algorithm: "fm" });
  const run1 = screenChannel(coverage, w, h, dpi, settings);
  const run2 = screenChannel(coverage, w, h, dpi, settings);
  check("determinismo: mesma contagem entre execuções", run1.length === run2.length);
  let identical = true;
  for (let i = 0; i < run1.length; i++) {
    if (run1[i].x !== run2[i].x || run1[i].y !== run2[i].y || run1[i].radius !== run2[i].radius) {
      identical = false;
      break;
    }
  }
  check("determinismo: mesmos dots (x,y,radius) entre execuções", identical);
}

// ---------------------------------------------------------------------------
// Canal vazio / canal cheio.
// ---------------------------------------------------------------------------
{
  const w = 60,
    h = 60;
  const empty = solidChannel(w, h, 0);
  const full = solidChannel(w, h, 1);
  for (const algorithm of ["am", "fm", "hybrid"] as const) {
    const emptyDots = screenChannel(empty, w, h, dpi, baseSettings({ algorithm }));
    check(`canal vazio (${algorithm}) -> 0 dots`, emptyDots.length === 0);
    const fullDots = screenChannel(full, w, h, dpi, baseSettings({ algorithm }));
    check(`canal cheio (${algorithm}) -> gera dots`, fullDots.length > 0);
  }
}

// ---------------------------------------------------------------------------
// Preset default: 4 canais com ângulos distintos.
// ---------------------------------------------------------------------------
{
  const angles = [
    DEFAULT_CMYK_SCREEN_SETTINGS.cyan.angle,
    DEFAULT_CMYK_SCREEN_SETTINGS.magenta.angle,
    DEFAULT_CMYK_SCREEN_SETTINGS.yellow.angle,
    DEFAULT_CMYK_SCREEN_SETTINGS.black.angle,
  ];
  check("preset default: 4 ângulos distintos", new Set(angles).size === 4);
}

console.log(`\n${passed} testes passaram.`);
