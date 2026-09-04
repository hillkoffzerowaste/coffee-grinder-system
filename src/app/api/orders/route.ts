import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { orderSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("orders").select("id,order_no,source,status,total_bags,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "โหลดออเดอร์ไม่สำเร็จ" }, { status: 500 });
  return NextResponse.json({ orders: data });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["counter", "packer", "admin"]);
  if (auth.error) return auth.error;
  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลออเดอร์ไม่ถูกต้อง", details: parsed.error.flatten() }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_client_request_id: parsed.data.clientRequestId,
    p_source: parsed.data.source,
    p_lines: parsed.data.lines,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ order: data }, { status: 201 });
}
