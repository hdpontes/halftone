import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { comparePassword } from "@/lib/password";
import { hasFullAccess } from "@/lib/subscription";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(request: Request) { const result = schema.safeParse(await request.json()); if (!result.success) return NextResponse.json({ error: "Informe e-mail e senha válidos." }, { status: 400 }); const user = await prisma.user.findUnique({ where: { email: result.data.email.toLowerCase() } }); if (!user || !(await comparePassword(result.data.password, user.passwordHash)) || !(await hasFullAccess(user.id))) return NextResponse.json({ error: "Acesso não autorizado. Verifique seus dados ou sua compra." }, { status: 401 }); await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }); await createSession({ id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword }); return NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword }); }