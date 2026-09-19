import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { expireOverdueSubscriptions, getCurrentSubscription, getPlanConfig, hasFullAccess } from "@/lib/subscription";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  await expireOverdueSubscriptions(session.id);
  const subscription = await getCurrentSubscription(session.id);
  const hasAccess = await hasFullAccess(session.id);

  if (!subscription) return NextResponse.json({ hasAccess, subscription: null });

  return NextResponse.json({
    hasAccess,
    subscription: {
      plan: subscription.plan,
      planName: getPlanConfig(subscription.plan)?.name ?? subscription.plan,
      status: subscription.status,
      startsAt: subscription.startsAt,
      expiresAt: subscription.expiresAt,
    },
  });
}
