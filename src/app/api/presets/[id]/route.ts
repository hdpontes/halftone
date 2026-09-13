import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { id } = await params;
  const preset = await prisma.halftonePreset.findUnique({ where: { id } });
  if (!preset || preset.userId !== session.id) return NextResponse.json({ error: "Preset não encontrado." }, { status: 404 });
  await prisma.halftonePreset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
