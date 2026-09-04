import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const auth = await requireApiUser(["packer", "admin"]);
  if (auth.error) return auth.error;
  const status = new URL(request.url).searchParams.get("status");
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("bags").select("id,bag_no,queue_seq,status,product_name_snapshot,sku_snapshot,size_grams_snapshot,grind_value_snapshot,product_barcode_snapshot,grinder_name_snapshot,created_at,orders(order_no)").order("queue_seq", { ascending: true }).limit(100);
  if (status) query = query.eq("status", status);
  else query = query.in("status", ["QUEUED", "CLAIMED", "GRINDING", "GROUND", "PACKING", "BLOCKED"]);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "โหลดคิวไม่สำเร็จ" }, { status: 500 });
  return NextResponse.json({ jobs: data });
}
