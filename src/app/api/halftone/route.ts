import { NextResponse } from "next/server";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

const settingsSchema = z.object({
  lpi: z.coerce.number().int().min(10).max(120).default(45),
  angle: z.coerce.number().min(-90).max(90).default(45),
  dpi: z.coerce.number().int().min(150).max(600).default(300),
  dot: z.enum(["fine", "standard", "soft"]).default("standard")
});

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]);
const thresholdMaps = { fine: "h4x4a", standard: "h8x8a", soft: "h8x8o" } as const;

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
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { accessStatus: true } });
  if (!user || user.accessStatus !== "ACTIVE") return NextResponse.json({ error: "Sua assinatura não está ativa." }, { status: 403 });

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || !allowedTypes.has(image.type)) return NextResponse.json({ error: "Envie PNG, JPG, WEBP ou TIFF." }, { status: 400 });
  if (image.size > 50 * 1024 * 1024) return NextResponse.json({ error: "A imagem deve ter no máximo 50 MB." }, { status: 413 });
  const parsed = settingsSchema.safeParse({ lpi: form.get("lpi"), angle: form.get("angle"), dpi: form.get("dpi"), dot: form.get("dot") });
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros de halftone inválidos." }, { status: 400 });

  const { lpi, angle, dpi, dot } = parsed.data;
  const workspace = await mkdtemp(join(tmpdir(), "halftone-"));
  const inputPath = join(workspace, `${randomUUID()}-input`);
  const outputPath = join(workspace, `${randomUUID()}-output.png`);
  try {
    await writeFile(inputPath, Buffer.from(await image.arrayBuffer()));
    const map = lpi <= 30 ? "h16x16o" : thresholdMaps[dot];
    await runMagick([inputPath, "-auto-orient", "-alpha", "on", "-background", "none", "-colorspace", "Gray", "-virtual-pixel", "edge", "-distort", "SRT", String(angle), "-ordered-dither", map, "-density", String(dpi), "-units", "PixelsPerInch", `PNG32:${outputPath}`]);
    const output = await readFile(outputPath);
    await prisma.auditLog.create({ data: { action: "HALFTONE_EXPORT", email: session.email, metadata: { lpi, angle, dpi, dot, inputBytes: image.size } } });
    return new NextResponse(output, { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="halftone-${lpi}lpi-${angle}deg.png"`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Halftone processing failed", error);
    return NextResponse.json({ error: "Não foi possível processar a imagem." }, { status: 500 });
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}