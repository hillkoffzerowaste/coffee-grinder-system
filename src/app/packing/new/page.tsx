import { redirect } from "next/navigation";
import { currentProfile, canUseStation } from "@/lib/auth";
import { CounterWorkspace } from "@/components/counter-workspace";

export const dynamic = "force-dynamic";

export default async function PackingNewPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (!canUseStation(profile, "packing")) redirect("/login");
  return <CounterWorkspace profile={profile} source="PACKING_MANUAL" />;
}
