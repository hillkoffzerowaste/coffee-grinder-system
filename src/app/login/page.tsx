import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { currentProfile, stationLandingPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const profile = await currentProfile();
  if (profile) redirect(stationLandingPath(profile));
  return <LoginForm />;
}
