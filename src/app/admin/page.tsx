import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { AdminConsole } from "@/components/admin-console";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/packing");
  return <AdminConsole profile={profile} />;
}
