import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (typeof body?.password === "string") {
    const password = body.password;
    if (password.length < 6) return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 });
    const passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    return NextResponse.json({ ok: true });
  }
  const status = body?.status;
  if (status !== "ACTIVE" && status !== "SUSPENDED" && status !== "PENDING") return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  await prisma.user.update({ where: { id }, data: { accessStatus: status } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (id === session.id) return NextResponse.json({ error: "Você não pode excluir o próprio usuário." }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
