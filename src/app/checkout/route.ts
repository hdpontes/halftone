import { NextResponse } from "next/server";

export function GET(request: Request) {
  const checkout = process.env.NEXT_PUBLIC_HOTMART_CHECKOUT_URL || "https://pay.hotmart.com/SEU-CHECKOUT";
  return NextResponse.redirect(checkout.startsWith("http") ? checkout : new URL(checkout, request.url));
}