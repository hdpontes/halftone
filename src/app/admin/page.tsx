import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminStudio from "@/components/AdminStudio";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/halftone");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const plainUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accessStatus: user.accessStatus,
    createdAt: user.createdAt.toISOString(),
  }));
  return <AdminStudio initialUsers={plainUsers} currentUserId={session.id} />;
}
