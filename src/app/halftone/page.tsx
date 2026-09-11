import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HalftoneWorkspace from "@/components/HalftoneWorkspace";
import "../studio.css";

export default async function HalftonePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { accessStatus: true } });
  if (!user || user.accessStatus !== "ACTIVE") redirect("/dashboard");
  return <main className="app-shell studio-shell"><nav className="topbar"><div className="brand-mark">H<span>.</span></div><div className="nav-user"><span className="avatar">{session.name[0]}</span><span>{session.name}</span><a href="/api/auth/logout">Sair</a></div></nav><HalftoneWorkspace /></main>;
}