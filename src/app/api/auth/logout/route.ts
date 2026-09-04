import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPublicEnv } from "@/lib/env";

export async function POST() {
  if (!hasPublicEnv()) return NextResponse.json({ error: "ระบบยังไม่พร้อมเชื่อมต่อฐานข้อมูล" }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) return NextResponse.json({ error: "ออกจากระบบไม่สำเร็จ กรุณาลองใหม่" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
