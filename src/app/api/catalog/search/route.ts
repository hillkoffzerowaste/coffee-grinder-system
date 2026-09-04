import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import type { ProductLookup } from "@/lib/types";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!q || q.length > 100 || q.includes("\0")) {
    return NextResponse.json({error:"คำค้นต้องมีความยาว 1–100 ตัวอักษร"},{status:400});
  }
  try {
    const products = await readRows<ProductLookup>(auth.profile.id,`select p.id,p.sku,p.name,p.size_grams,p.unit,b.barcode
      from coffee.products p
      join lateral (select pb.barcode from coffee.product_barcodes pb
        where pb.product_id=p.id and pb.active order by pb.barcode limit 1) b on true
      where p.active and (strpos(lower(p.name),lower($1::text))>0 or strpos(lower(p.sku),lower($1::text))>0)
      order by p.name,p.sku,p.id limit 20`,[q]);
    return NextResponse.json({products});
  } catch (error) {
    const e = databaseError(error);
    return NextResponse.json({error:e.message},{status:e.status});
  }
}
