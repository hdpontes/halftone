import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "development-secret-change-me");
export type Session = { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" };

export async function createSession(session: Session) {
  const token = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
  (await cookies()).set("halftone_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("halftone_session")?.value;
  if (!token) return null;
  try { return (await jwtVerify(token, secret)).payload as unknown as Session; } catch { return null; }
}