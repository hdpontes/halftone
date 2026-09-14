import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, getSession } from "@/lib/auth";
import { comparePassword, hashPassword } from "@/lib/password";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe a senha atual e a nova senha (mínimo 6 caracteres)." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || !(await comparePassword(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 401 });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
  await createSession({ id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: false });

  return NextResponse.json({ ok: true });
}
