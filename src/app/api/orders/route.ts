import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import {orderSchema} from "@/lib/validation";
export async function GET() {
 const auth=await requireApiUser();if(auth.error)return auth.error;
 try{return NextResponse.json({orders:await readRows(auth.profile.id,`select o.id,o.order_no,o.source,o.status,o.total_bags,o.created_at,
   coalesce((select jsonb_object_agg(s.status,s.n) from (select b.status,count(*)::int n from coffee.bags b where b.order_id=o.id group by b.status) s),'{}'::jsonb) progress
   from coffee.orders o order by (o.status='OPEN') desc,o.created_at desc limit 50`)});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
export async function POST(request:Request) {
 const auth=await requireApiUser();if(auth.error)return auth.error;
 const parsed=orderSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลออเดอร์ไม่ถูกต้อง"},{status:400});
 try{const [row]=await readRows(auth.profile.id,"select coffee.create_order($1,$2,$3::jsonb) as result",[parsed.data.clientRequestId,parsed.data.source,JSON.stringify(parsed.data.lines)]);
 return NextResponse.json({order:row.result},{status:201});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
