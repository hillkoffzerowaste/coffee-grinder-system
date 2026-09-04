import { NextResponse } from "next/server";
import { authEmail, hasPublicEnv } from "@/lib/env";
import { loginSchema } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canUseStation } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง" }, { status: 400 });
  if (!hasPublicEnv()) return NextResponse.json({ error: "ระบบยังไม่พร้อมเชื่อมต่อฐานข้อมูล กรุณาติดต่อผู้ดูแล" }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail(parsed.data.username),
    password: parsed.data.password,
  });
  if (error || !data.user) return NextResponse.json({ error: "Username หรือ Password ไม่ถูกต้อง" }, { status: 401 });
  const { data: profileData } = await supabase.from("profiles").select("id,username,display_name,role,station,active").eq("id", data.user.id).maybeSingle();
  const profile = profileData as Profile | null;
  if (!profile?.active || !canUseStation(profile, parsed.data.station)) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "บัญชีนี้ไม่มีสิทธิ์ใช้สถานีที่เลือก" }, { status: 403 });
  }
  return NextResponse.json({ profile, destination: parsed.data.station === "counter" ? "/counter" : "/packing" });
}
