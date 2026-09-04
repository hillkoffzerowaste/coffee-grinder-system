import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";
import { canUseStation } from "@/lib/permissions";
export { canUseStation } from "@/lib/permissions";

export async function currentProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("id,username,display_name,role,station,active").eq("id", user.id).maybeSingle();
  return data?.active ? (data as Profile) : null;
}

export async function requireApiUser(roles?: AppRole[]) {
  const profile = await currentProfile();
  if (!profile) return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  if (!canUseStation(profile, "counter") && !canUseStation(profile, "packing")) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  if (roles && !roles.includes(profile.role)) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { profile };
}
