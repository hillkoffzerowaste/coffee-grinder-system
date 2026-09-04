import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_: Request, context: { params: Promise<{ barcode: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const { barcode } = await context.params;
  if (!/^\d{4,32}$/.test(barcode)) return NextResponse.json({ error: "รูปแบบบาร์โค้ดไม่ถูกต้อง" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_barcodes")
    .select("barcode,products!inner(id,sku,name,size_grams,unit,active)")
    .eq("barcode", barcode)
    .eq("active", true)
    .eq("products.active", true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "ค้นหาสินค้าไม่สำเร็จ" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "ไม่พบ Product Barcode" }, { status: 404 });
  const raw = data.products as unknown;
  const product = (Array.isArray(raw) ? raw[0] : raw) as { id: string; sku: string; name: string; size_grams: number; unit: string };
  return NextResponse.json({ product: { ...product, barcode: data.barcode } });
}
