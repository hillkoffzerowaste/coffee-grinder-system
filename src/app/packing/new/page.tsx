import { redirect } from "next/navigation";
import { currentProfile, canUseStation } from "@/lib/auth";
import { PackingWorkspace } from "@/components/packing-workspace";
import { publishedUiConfig } from "@/lib/ui-config-server";

export const dynamic = "force-dynamic";

export default async function PackingNewPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  if (!canUseStation(profile, "packing")) redirect("/login");
  return <PackingWorkspace profile={profile} initialManual uiConfig={await publishedUiConfig(profile.id)} />;
}
