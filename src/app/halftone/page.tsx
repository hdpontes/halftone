import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HalftoneStudio from "@/components/HalftoneStudio";

export default async function HalftonePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { accessStatus: true } });
  if (!user || user.accessStatus !== "ACTIVE") redirect("/login");
  return <HalftoneStudio />;
}
