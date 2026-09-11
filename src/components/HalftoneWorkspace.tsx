"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

type Dot = "fine" | "standard" | "soft";
const matrices: Record<Dot, number[][]> = {
  fine: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
  standard: [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]],
  soft: [[0, 48, 12, 60], [32, 16, 44, 28], [8, 56, 4, 52], [40, 24, 36, 20]]
};

export default function HalftoneWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [lpi, setLpi] = useState(45);
  const [angle, setAngle] = useState(45);
  const [dpi, setDpi] = useState(300);
  const [dot, setDot] = useState<Dot>("standard");
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); }, [sourceUrl, resultUrl]);

  function chooseImage(selected: File) {
    if (!selected.type.startsWith("image/")) { setError("Escolha um arquivo de imagem."); return; }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(selected); setSourceUrl(URL.createObjectURL(selected)); setResultUrl(""); setError("");
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) { const selected = event.target.files?.[0]; if (selected) chooseImage(selected); }
  function onDrop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); setDragging(false); const selected = event.dataTransfer.files[0]; if (selected) chooseImage(selected); }

  useEffect(() => {
    if (!sourceUrl || !canvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current!; const max = 900; const scale = Math.min(1, max / image.width, max / image.height); const width = Math.max(1, Math.round(image.width * scale)); const height = Math.max(1, Math.round(image.height * scale));
      canvas.width = width; canvas.height = height; const context = canvas.getContext("2d", { willReadFrequently: true })!; context.save(); context.translate(width / 2, height / 2); context.rotate(angle * Math.PI / 180); context.drawImage(image, -width / 2, -height / 2, width, height); context.restore(); const pixels = context.getImageData(0, 0, width, height); const matrix = lpi <= 30 ? matrices.soft : lpi >= 80 ? matrices.fine : matrices[dot]; const size = matrix.length;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const index = (y * width + x) * 4; const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114; const threshold = (matrix[y % size][x % size] + .5) * (255 / (size * size)); const value = gray > threshold ? 255 : 0; pixels.data[index] = value; pixels.data[index + 1] = value; pixels.data[index + 2] = value; pixels.data[index + 3] = 255; }
      context.putImageData(pixels, 0, 0);
    };
    image.src = sourceUrl;
  }, [sourceUrl, dot, lpi, angle]);

  async function exportImage() {
    if (!file) return; setProcessing(true); setError(""); const body = new FormData(); body.append("image", file); body.append("lpi", String(lpi)); body.append("angle", String(angle)); body.append("dpi", String(dpi)); body.append("dot", dot);
    try { const response = await fetch("/api/halftone", { method: "POST", body }); if (!response.ok) throw new Error((await response.json()).error || "Falha ao processar"); const blob = await response.blob(); setResultUrl(URL.createObjectURL(blob)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao processar a imagem."); } finally { setProcessing(false); }
  }

  return <section className="studio"><header className="studio-header"><div><p className="eyebrow muted">HALFTONE ENGINE / 01</p><h1>Retícula de precisão.</h1><p>Prepare sua arte para DTF com controle sobre frequência, ângulo e densidade.</p></div><a className="back-link" href="/dashboard">← Painel</a></header><div className="studio-grid"><aside className="studio-controls"><div className="control-title"><span>PARAMETROS</span><b>H.</b></div><label>LPI / FREQUÊNCIA<strong>{lpi}</strong><input type="range" min="10" max="120" step="5" value={lpi} onChange={(event) => setLpi(Number(event.target.value))} /></label><label>ÂNGULO<strong>{angle}°</strong><input type="range" min="-90" max="90" step="2.5" value={angle} onChange={(event) => setAngle(Number(event.target.value))} /></label><label>DPI DE EXPORTAÇÃO<strong>{dpi}</strong><input type="range" min="150" max="600" step="50" value={dpi} onChange={(event) => setDpi(Number(event.target.value))} /></label><div className="select-control"><span>FORMA DO PONTO</span><select value={dot} onChange={(event) => setDot(event.target.value as Dot)}><option value="fine">Fino / detalhe</option><option value="standard">Padrão / equilibrado</option><option value="soft">Suave / orgânico</option></select></div><div className="spec-note"><span>OUTPUT</span><p>PNG transparente<br />{dpi} DPI · {lpi} LPI</p></div></aside><div className="studio-stage">{!file ? <label className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><span className="upload-mark">+</span><strong>Solte sua arte aqui</strong><span>ou clique para escolher PNG, JPG, WEBP ou TIFF</span><input type="file" accept="image/png,image/jpeg,image/webp,image/tiff" onChange={onInput} /></label> : <><div className="preview-header"><span>PREVIEW LOCAL / CANVAS</span><button onClick={() => { setFile(null); setSourceUrl(""); setResultUrl(""); }}>Trocar arte</button></div><div className="canvas-wrap"><canvas ref={canvasRef} /><span className="canvas-label">HALFTONE PREVIEW</span></div><div className="studio-actions">{error && <p className="error">{error}</p>}{resultUrl ? <a className="button button-light" href={resultUrl} download={`halftone-${lpi}lpi-${angle}deg.png`}>Baixar PNG de alta resolução <span>↓</span></a> : <button className="button button-dark" onClick={exportImage} disabled={processing}>{processing ? "Renderizando arquivo..." : "Exportar halftone"}<span>↗</span></button>}</div></>}</div></div></section>;
}