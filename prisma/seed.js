const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@halftone.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-this-password";
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", accessStatus: "ACTIVE", passwordHash },
    create: { name: "Administrador", email, passwordHash, role: "ADMIN", accessStatus: "ACTIVE" }
  });
  console.log(`Admin ready: ${email}`);
}

main().finally(() => prisma.$disconnect());