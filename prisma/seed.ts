import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@halftone.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-this-password";
  await prisma.user.upsert({ where: { email }, update: { role: "ADMIN", accessStatus: "ACTIVE", passwordHash: await bcrypt.hash(password, 12) }, create: { name: "Administrador", email, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN", accessStatus: "ACTIVE" } });
  console.log(`Admin ready: ${email}`);
}
main().finally(() => prisma.$disconnect());
