import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "ADMIN" ? "ADMIN" : "MEMBER";
  if (!name || !email || !password) return NextResponse.json({ error: "Preencha nome, email e senha." }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "Já existe um usuário com esse email." }, { status: 409 });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash, role, accessStatus: "ACTIVE", mustChangePassword: true } });
  return NextResponse.json({ id: user.id, createdAt: user.createdAt.toISOString() });
}
