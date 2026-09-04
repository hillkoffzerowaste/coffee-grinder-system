import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_: Request, context: { params: Promise<{ barcode: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const { barcode } = await context.params;
  if (!/^\d{1,32}$/.test(barcode)) return NextResponse.json({ error: "รูปแบบบาร์โค้ดเบอร์บดไม่ถูกต้อง" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("grind_size_codes").select("id,grind_value,barcode").eq("barcode", barcode).eq("active", true).maybeSingle();
  if (error) return NextResponse.json({ error: "ค้นหาเบอร์บดไม่สำเร็จ" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "ไม่พบ Grind Barcode" }, { status: 404 });
  return NextResponse.json({ grind: data });
}
