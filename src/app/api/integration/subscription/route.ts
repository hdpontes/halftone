import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeExpiresAt, getCurrentSubscription, getPlanConfig } from "@/lib/subscription";

const payloadSchema = z
  .object({
    email: z.string().email().optional(),
    hotmartId: z.string().optional(),
    planId: z.string().min(1),
    hotmartTransaction: z.string().min(1),
    hotmartSubscriptionId: z.string().optional(),
    hotmartProductId: z.string().optional(),
    hotmartOfferCode: z.string().optional(),
  })
  .refine((data) => data.email || data.hotmartId, { message: "Informe email ou hotmartId." });

export async function POST(request: Request) {
  if (request.headers.get("x-n8n-secret") !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  const data = parsed.data;

  const plan = getPlanConfig(data.planId);
  if (!plan) return NextResponse.json({ error: "Plano desconhecido" }, { status: 400 });

  const user = await prisma.user.findFirst({
    where: data.hotmartId ? { hotmartId: data.hotmartId } : { email: data.email!.toLowerCase() },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const existing = await prisma.subscription.findUnique({ where: { hotmartTransaction: data.hotmartTransaction } });
  if (existing) return NextResponse.json({ ok: true, subscriptionId: existing.id, expiresAt: existing.expiresAt, idempotent: true });

  const current = await getCurrentSubscription(user.id);
  const expiresAt = computeExpiresAt(current?.expiresAt ?? null, plan.durationDays);

  const subscription = await prisma.subscription.create({
    data: {
      userId: user.id,
      plan: data.planId,
      status: "ACTIVE",
      hotmartTransaction: data.hotmartTransaction,
      hotmartSubscriptionId: data.hotmartSubscriptionId,
      hotmartProductId: data.hotmartProductId,
      hotmartOfferCode: data.hotmartOfferCode,
      expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: current ? "SUBSCRIPTION_RENEWED" : "SUBSCRIPTION_CREATED",
      email: user.email,
      metadata: { planId: data.planId, hotmartTransaction: data.hotmartTransaction, expiresAt },
    },
  });

  return NextResponse.json({ ok: true, subscriptionId: subscription.id, expiresAt: subscription.expiresAt });
}
