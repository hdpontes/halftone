import { prisma } from "@/lib/prisma";
import type { Subscription, SubscriptionStatus } from "@prisma/client";

// Centralized plan config, keyed by Hotmart plan ID (not name). Add new plans/products here.
export const HOTMART_PLANS: Record<string, { name: string; durationDays: number }> = {
  "halftone-pro-mensal": { name: "Halftone Pro Mensal", durationDays: 30 },
  "halftone-pro-anual": { name: "Halftone Pro Anual", durationDays: 365 },
};

export function getPlanConfig(planId: string) {
  return HOTMART_PLANS[planId];
}

// Extends from the current expiresAt when it is still in the future, otherwise starts counting from `from`.
export function computeExpiresAt(previousExpiresAt: Date | null, durationDays: number, from: Date = new Date()) {
  const base = previousExpiresAt && previousExpiresAt > from ? previousExpiresAt : from;
  return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

// Most relevant subscription for a user: prefer an ACTIVE one, otherwise the most recently expiring one.
export async function getCurrentSubscription(userId: string): Promise<Subscription | null> {
  const active = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { expiresAt: "desc" },
  });
  if (active) return active;
  return prisma.subscription.findFirst({ where: { userId }, orderBy: { expiresAt: "desc" } });
}

// CANCELED still grants access until expiresAt (cancellation only stops renewal); REFUNDED/CHARGEBACK never do.
export async function hasValidSubscription(userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "CANCELED"] }, expiresAt: { gt: new Date() } },
  });
  return !!subscription;
}

// Flips ACTIVE/CANCELED subscriptions past expiresAt to EXPIRED. Called at request-time, not only via cron.
export async function expireOverdueSubscriptions(userId: string) {
  await prisma.subscription.updateMany({
    where: { userId, status: { in: ["ACTIVE", "CANCELED"] }, expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" as SubscriptionStatus },
  });
}

// Single source of truth for access gating: accessStatus (admin-controlled) AND, for Hotmart-linked
// accounts only, a valid unexpired subscription. Manually created accounts (no hotmartId) rely on accessStatus alone.
export async function hasFullAccess(userId: string) {
  await expireOverdueSubscriptions(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accessStatus: true, hotmartId: true } });
  if (!user || user.accessStatus !== "ACTIVE") return false;
  if (!user.hotmartId) return true;
  return hasValidSubscription(userId);
}
