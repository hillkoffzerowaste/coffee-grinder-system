import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const supabase = await createSupabaseServerClient();
  const [grinds, grinders] = await Promise.all([
    supabase.from("grind_size_codes").select("id,grind_value,barcode").eq("active", true).order("sort_order"),
    supabase.from("grinder_users").select("id,name").eq("active", true).order("sort_order"),
  ]);
  if (grinds.error || grinders.error) return NextResponse.json({ error: "โหลด Master Data ไม่สำเร็จ" }, { status: 500 });
  return NextResponse.json({ grinds: grinds.data, grinders: grinders.data });
}
