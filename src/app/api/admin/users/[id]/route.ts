import { NextResponse } from "next/server";
import { getSession, absoluteUrl } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData();
  const status = form.get("status");
  if (status !== "ACTIVE" && status !== "SUSPENDED") return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  await prisma.user.update({ where: { id: (await context.params).id }, data: { accessStatus: status } });
  return NextResponse.redirect(absoluteUrl("/admin", request));
}
