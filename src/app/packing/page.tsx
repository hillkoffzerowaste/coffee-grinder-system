import { redirect } from "next/navigation";
import { currentProfile, canUseStation } from "@/lib/auth";
import { PackingWorkspace } from "@/components/packing-workspace";

export const dynamic = "force-dynamic";

export default async function PackingPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (!canUseStation(profile, "packing")) redirect("/login");
  return <PackingWorkspace profile={profile} />;
}
