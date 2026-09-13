import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { hasFullAccess } from "@/lib/subscription";
import HalftoneStudio from "@/components/HalftoneStudio";

export default async function HalftonePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasFullAccess(session.id))) redirect("/login");
  return <HalftoneStudio />;
}
