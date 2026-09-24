import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const BLOCK_EVENTS = new Set(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"]);
const CANCEL_EVENTS = new Set(["PURCHASE_CANCELED"]);

const payloadSchema = z.object({
  event: z.string(),
  data: z.object({
    purchase: z.object({ transaction: z.string().optional() }).optional(),
    subscription: z.object({ subscriber: z.object({ code: z.string().optional() }).optional() }).optional(),
  }),
});

export async function POST(request: Request) {
  // Never log the hottok value itself, only whether it matched.
  const hottok = request.headers.get("x-hotmart-hottok");
  if (!hottok || hottok !== process.env.HOTMART_HOTTOK) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  const { event, data } = parsed.data;

  if (!BLOCK_EVENTS.has(event) && !CANCEL_EVENTS.has(event)) {
    // Other events (e.g. PURCHASE_APPROVED) are handled by n8n via /api/integration/subscription.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const transaction = data.purchase?.transaction;
  const subscriberCode = data.subscription?.subscriber?.code;
  if (!transaction && !subscriberCode) return NextResponse.json({ error: "Identificador da compra ausente" }, { status: 400 });

  const subscription = transaction
    ? await prisma.subscription.findUnique({ where: { hotmartTransaction: transaction }, include: { user: true } })
    : await prisma.subscription.findFirst({
        where: { hotmartSubscriptionId: subscriberCode },
        orderBy: { expiresAt: "desc" },
        include: { user: true },
      });

  if (!subscription) return NextResponse.json({ ok: true, notFound: true });

  // Idempotency: a terminal block state is never overwritten.
  if (subscription.status === "REFUNDED" || subscription.status === "CHARGEBACK") {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  if (BLOCK_EVENTS.has(event)) {
    const status = event === "PURCHASE_REFUNDED" ? "REFUNDED" : "CHARGEBACK";
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status } });
    await prisma.auditLog.create({
      data: { action: `SUBSCRIPTION_${status}`, email: subscription.user.email, metadata: { hotmartTransaction: subscription.hotmartTransaction } },
    });
  } else if (subscription.status !== "CANCELED") {
    // Cancellation stops renewal but access remains until expiresAt (request-time expiration flips it to EXPIRED later).
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "CANCELED" } });
    await prisma.auditLog.create({
      data: { action: "SUBSCRIPTION_CANCELED", email: subscription.user.email, metadata: { hotmartTransaction: subscription.hotmartTransaction } },
    });
  }

  return NextResponse.json({ ok: true });
}
