import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const presets = await prisma.halftonePreset.findMany({ where: { userId: session.id }, orderBy: { name: "asc" } });
  return NextResponse.json({ presets: presets.map((p) => ({ id: p.id, name: p.name, data: p.data })) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const data = body?.data;
  if (!name) return NextResponse.json({ error: "Informe um nome para o preset." }, { status: 400 });
  if (!data || typeof data !== "object") return NextResponse.json({ error: "Configuração de preset inválida." }, { status: 400 });

  const preset = await prisma.halftonePreset.upsert({
    where: { userId_name: { userId: session.id, name } },
    update: { data },
    create: { userId: session.id, name, data },
  });
  return NextResponse.json({ id: preset.id, name: preset.name, data: preset.data });
}
