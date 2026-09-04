import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";

export async function GET(_: Request, context: {params:Promise<{barcode:string}>}) {
 const auth=await requireApiUser(); if(auth.error)return auth.error;
 const {barcode}=await context.params;
 if(!/^\d{1,32}$/.test(barcode)) return NextResponse.json({error:"รูปแบบบาร์โค้ดไม่ถูกต้อง"},{status:400});
 try {
 const [item]=await readRows(auth.profile.id,"select id,grind_value,barcode from coffee.grind_size_codes where barcode=$1 and active",[barcode]);
 if(!item)return NextResponse.json({error:"ไม่พบบาร์โค้ด"},{status:404});
 return NextResponse.json({grind:item});
 } catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
