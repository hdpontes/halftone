import { NextResponse } from "next/server";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasFullAccess } from "@/lib/subscription";

export const runtime = "nodejs";
export const maxDuration = 120;

const settingsSchema = z.object({
  mode: z.enum(["mono", "cmyk"]).default("mono"),
  lpi: z.coerce.number().int().min(10).max(120).default(45),
  angle: z.coerce.number().min(-90).max(90).default(45),
  dpi: z.coerce.number().int().refine((value) => value === 300, "A saída DTF deve ser 300 DPI").default(300),
  dot: z.enum(["round", "ellipse", "line"]).default("round"),
  contrast: z.coerce.number().min(-40).max(40).default(0),
  brightness: z.coerce.number().min(-40).max(40).default(0),
  transparent: z.preprocess((value) => value === "true" || value === true, z.boolean()).default(true)
});

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]);
const thresholdMaps = { round: "h8x8a", ellipse: "h4x4a", line: "h4x4o" } as const;

function runMagick(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("magick", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `ImageMagick exited with ${code}`)));
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Faça login para usar o Halftone Studio." }, { status: 401 });
  if (!(await hasFullAccess(session.id))) return NextResponse.json({ error: "Sua assinatura não está ativa." }, { status: 403 });

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || !allowedTypes.has(image.type)) return NextResponse.json({ error: "Envie PNG, JPG, WEBP ou TIFF." }, { status: 400 });
  if (image.size > 50 * 1024 * 1024) return NextResponse.json({ error: "A imagem deve ter no máximo 50 MB." }, { status: 413 });
  const parsed = settingsSchema.safeParse({ mode: form.get("mode"), lpi: form.get("lpi"), angle: form.get("angle"), dpi: form.get("dpi"), dot: form.get("dot"), contrast: form.get("contrast"), brightness: form.get("brightness"), transparent: form.get("transparent") });
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros de halftone inválidos." }, { status: 400 });

  const { mode, lpi, angle, dpi, dot, contrast, brightness, transparent } = parsed.data;
  const workspace = await mkdtemp(join(tmpdir(), "halftone-"));
  const inputPath = join(workspace, `${randomUUID()}-input`);
  const outputPath = join(workspace, `${randomUUID()}-output.png`);
  try {
    await writeFile(inputPath, Buffer.from(await image.arrayBuffer()));
    const map = lpi <= 30 ? "h16x16o" : thresholdMaps[dot];
    const colorspace = mode === "cmyk" ? "CMYK" : "Gray";
    const outputColorspace = mode === "cmyk" ? "sRGB" : "Gray";
    const args = [inputPath, "-auto-orient", "-alpha", "on", "-background", "none", "-colorspace", colorspace, "-brightness-contrast", `${brightness}x${contrast}`, "-virtual-pixel", "edge", "-distort", "SRT", String(angle), "-ordered-dither", map, "-colorspace", outputColorspace, "-density", String(dpi), "-units", "PixelsPerInch"];
    if (transparent) args.push("-transparent", "white");
    args.push(`PNG32:${outputPath}`);
    await runMagick(args);
    const output = await readFile(outputPath);
    await prisma.auditLog.create({ data: { action: "HALFTONE_EXPORT", email: session.email, metadata: { mode, lpi, angle, dpi, dot, contrast, brightness, transparent, inputBytes: image.size } } });
    return new NextResponse(output, { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="halftone-${lpi}lpi-${angle}deg.png"`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Halftone processing failed", error);
    return NextResponse.json({ error: "Não foi possível processar a imagem." }, { status: 500 });
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}