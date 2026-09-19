import { NextResponse } from "next/server";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasFullAccess } from "@/lib/subscription";
import { runProfessionalExportWorker } from "@/lib/halftone/professional-export-worker";

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
    const exportResult = await runProfessionalExportWorker({
      inputPath,
      outputPath,
      mode,
      lpi,
      angle,
      dpi,
      dot,
      contrast,
      brightness,
      transparent,
    });
    const output = await readFile(outputPath);
    await prisma.auditLog.create({
      data: {
        action: "HALFTONE_EXPORT",
        email: session.email,
        metadata: {
          mode,
          lpi,
          angle,
          dpi,
          dot,
          contrast,
          brightness,
          transparent,
          inputBytes: image.size,
          backendEngine: exportResult.engineUsed,
        },
      },
    });
    return new NextResponse(output, { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="halftone-${lpi}lpi-${angle}deg.png"`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Halftone processing failed", error);
    return NextResponse.json({ error: "Não foi possível processar a imagem." }, { status: 500 });
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}
