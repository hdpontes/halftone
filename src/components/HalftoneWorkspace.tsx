"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

type Mode = "mono" | "cmyk";
type Dot = "round" | "ellipse" | "line";
type Preset = "dtf" | "fine" | "poster";

const matrices: Record<Dot, number[][]> = {
  round: [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]],
  ellipse: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
  line: [[0, 2, 4, 6], [8, 10, 12, 14], [1, 3, 5, 7], [9, 11, 13, 15]]
};

const presets: Record<Preset, { lpi: number; dpi: number; dot: Dot; angle: number }> = {
  dtf: { lpi: 45, dpi: 300, dot: "round", angle: 45 },
  fine: { lpi: 65, dpi: 600, dot: "ellipse", angle: 45 },
  poster: { lpi: 30, dpi: 300, dot: "line", angle: 22.5 }
};

export default function HalftoneWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [mode, setMode] = useState<Mode>("mono");
  const [dot, setDot] = useState<Dot>("round");
  const [lpi, setLpi] = useState(45);
  const [angle, setAngle] = useState(45);
  const [dpi, setDpi] = useState(300);
  const [contrast, setContrast] = useState(0);
  const [brightness, setBrightness] = useState(0);
  const [transparent, setTransparent] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); }, [sourceUrl, resultUrl]);

  function chooseImage(selected: File) {
    if (!selected.type.startsWith("image/")) { setError("Escolha uma imagem PNG, JPG, WEBP ou TIFF."); return; }
    if (selected.size > 50 * 1024 * 1024) { setError("O limite por arquivo e 50 MB."); return; }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(selected); setSourceUrl(URL.createObjectURL(selected)); setResultUrl(""); setError("");
  }

  function applyPreset(preset: Preset) { const values = presets[preset]; setLpi(values.lpi); setDpi(values.dpi); setDot(values.dot); setAngle(values.angle); }
  function onInput(event: ChangeEvent<HTMLInputElement>) { const selected = event.target.files?.[0]; if (selected) chooseImage(selected); }
  function onDrop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); setDragging(false); const selected = event.dataTransfer.files[0]; if (selected) chooseImage(selected); }

  useEffect(() => {
    if (!sourceUrl || !canvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current!; const max = 980; const scale = Math.min(1, max / image.width, max / image.height); const width = Math.max(1, Math.round(image.width * scale)); const height = Math.max(1, Math.round(image.height * scale));
      canvas.width = width; canvas.height = height; const context = canvas.getContext("2d", { willReadFrequently: true })!; context.clearRect(0, 0, width, height); context.save(); context.translate(width / 2, height / 2); context.rotate(angle * Math.PI / 180); context.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`; context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
      const pixels = context.getImageData(0, 0, width, height); const matrix = matrices[dot]; const size = matrix.length; const scaleByLpi = Math.max(1, Math.round(65 / lpi));
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const index = (y * width + x) * 4; const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; const threshold = (matrix[Math.floor(y / scaleByLpi) % size][Math.floor(x / scaleByLpi) % size] + .5) * (255 / (size * size)); const value = gray > threshold ? 255 : 0; pixels.data[index] = value; pixels.data[index + 1] = value; pixels.data[index + 2] = value; pixels.data[index + 3] = transparent ? (value === 255 ? 0 : 255) : 255; }
      context.putImageData(pixels, 0, 0);
    };
    image.src = sourceUrl;
  }, [sourceUrl, dot, lpi, angle, brightness, contrast, transparent]);

  async function exportImage() {
    if (!file) return; setProcessing(true); setError(""); const body = new FormData(); body.append("image", file); body.append("mode", mode); body.append("lpi", String(lpi)); body.append("angle", String(angle)); body.append("dpi", String(dpi)); body.append("dot", dot); body.append("contrast", String(contrast)); body.append("brightness", String(brightness)); body.append("transparent", String(transparent));
    try { const response = await fetch("/api/halftone", { method: "POST", body }); if (!response.ok) throw new Error((await response.json()).error || "Falha ao exportar"); const blob = await response.blob(); setResultUrl(URL.createObjectURL(blob)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao exportar a imagem."); } finally { setProcessing(false); }
  }

  return <section className="tool-app"><header className="tool-header"><div className="tool-title"><p className="eyebrow muted">HPBOOST / HALFTONE TOOL</p><h1>Retícula de precisão.</h1><p>Converta qualquer arte em um arquivo limpo e pronto para produção DTF.</p></div><div className="tool-header-actions"><span className="tool-status"><i /> MOTOR ONLINE</span><a className="back-link" href="/api/auth/logout">Sair</a></div></header><div className="tool-layout"><aside className="tool-sidebar"><div className="panel-heading"><span>CONFIGURAÇÃO</span><b>01</b></div><div className="preset-row"><button className="preset active" onClick={() => applyPreset("dtf")}>DTF</button><button className="preset" onClick={() => applyPreset("fine")}>Fino</button><button className="preset" onClick={() => applyPreset("poster")}>Poster</button></div><div className="control-group"><span className="control-label">MODO DE SAÍDA</span><div className="segmented"><button className={mode === "mono" ? "selected" : ""} onClick={() => setMode("mono")}>Mono</button><button className={mode === "cmyk" ? "selected" : ""} onClick={() => setMode("cmyk")}>CMYK</button></div></div><div className="control-group"><span className="control-label">LPI / FREQUÊNCIA<strong>{lpi}</strong></span><input type="range" min="10" max="120" step="5" value={lpi} onChange={(event) => setLpi(Number(event.target.value))} /></div><div className="control-group"><span className="control-label">ÂNGULO<strong>{angle}°</strong></span><input type="range" min="0" max="90" step="2.5" value={angle} onChange={(event) => setAngle(Number(event.target.value))} /></div><div className="control-group"><span className="control-label">DPI DE SAÍDA<strong>{dpi}</strong></span><input type="range" min="150" max="600" step="50" value={dpi} onChange={(event) => setDpi(Number(event.target.value))} /></div><div className="control-group"><span className="control-label">CONTRASTE<strong>{contrast > 0 ? "+" : ""}{contrast}</strong></span><input type="range" min="-40" max="40" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></div><div className="control-group"><span className="control-label">BRILHO<strong>{brightness > 0 ? "+" : ""}{brightness}</strong></span><input type="range" min="-40" max="40" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /></div><div className="control-group"><span className="control-label">FORMA DO PONTO</span><select value={dot} onChange={(event) => setDot(event.target.value as Dot)}><option value="round">Redondo</option><option value="ellipse">Elipse</option><option value="line">Linha</option></select></div><label className="check-control"><input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} /><span>Fundo transparente</span><b>DTF</b></label><div className="output-spec"><span>ARQUIVO DE PRODUÇÃO</span><strong>PNG / {dpi} DPI</strong><small>{mode === "cmyk" ? "Separação CMYK simulada" : "Canal monocromático"}<br />Retícula {lpi} LPI · {angle}°</small></div></aside><main className="tool-canvas-area">{!file ? <label className={`dropzone tool-dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><span className="upload-mark">+</span><strong>Importe sua arte</strong><span>Arraste aqui ou clique para selecionar</span><small>PNG, JPG, WEBP ou TIFF · máximo 50 MB</small><input type="file" accept="image/png,image/jpeg,image/webp,image/tiff" onChange={onInput} /></label> : <><div className="canvas-toolbar"><div><span className="canvas-kicker">PREVIEW APLICADO</span><strong>{file.name}</strong></div><button onClick={() => { setFile(null); setSourceUrl(""); setResultUrl(""); }}>Nova imagem</button></div><div className="canvas-frame"><canvas ref={canvasRef} /><span className="canvas-stamp">{mode.toUpperCase()} / {lpi} LPI / {dpi} DPI</span></div><div className="export-bar">{error && <p className="error">{error}</p>}{resultUrl ? <><span className="ready-message">Arquivo gerado e pronto para imprimir.</span><a className="button button-light" href={resultUrl} download={`hpboost-halftone-${lpi}lpi-${angle}deg.png`}>Baixar arquivo DTF <span>↓</span></a></> : <button className="button button-dark" onClick={exportImage} disabled={processing}>{processing ? "Renderizando arquivo..." : "Gerar arquivo para DTF"}<span>↗</span></button>}</div></>}</main></div></section>;
+}
