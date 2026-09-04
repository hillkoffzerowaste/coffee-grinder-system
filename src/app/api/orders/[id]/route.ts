import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiUser} from "@/lib/auth";
import {readRows,databaseError} from "@/lib/db";
export async function GET(_:Request,context:{params:Promise<{id:string}>}){
 const auth=await requireApiUser();if(auth.error)return auth.error;
 const {id}=await context.params;if(!z.uuid().safeParse(id).success)return NextResponse.json({error:"รหัสออเดอร์ไม่ถูกต้อง"},{status:400});
 try{
  const bags=await readRows(auth.profile.id,`select b.id,b.bag_no,b.queue_seq,b.status,b.product_name_snapshot,b.size_grams_snapshot,b.grind_value_snapshot,b.grinder_name_snapshot,b.started_at,b.ground_at,b.completed_at,
   coalesce((select jsonb_agg(jsonb_build_object('status',e.to_status,'at',e.created_at) order by e.created_at) from coffee.job_events e where e.bag_id=b.id),'[]'::jsonb) events
   from coffee.bags b where b.order_id=$1 order by b.bag_no`,[id]);
  return NextResponse.json({bags});
 }catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
