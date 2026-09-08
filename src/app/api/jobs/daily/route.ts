import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
export async function GET(){
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 // ขอบวันต้องเป็นเที่ยงคืนตามเวลาไทย ไม่ใช่ UTC ไม่งั้นกะเช้าจะเห็นงานของเมื่อวานปนมา
 try{const [row]=await readRows(auth.profile.id,`with day_start as (
   select date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' as from_ts),
  done as (select b.* from coffee.bags b, day_start d where b.status='COMPLETED' and b.completed_at >= d.from_ts)
  select (select from_ts from day_start) as day_start,
   (select count(*) from done)::int as bags,
   coalesce((select sum(size_grams_snapshot) from done),0)::int as grams,
   (select count(distinct order_id) from done)::int as orders,
   coalesce((select jsonb_agg(g) from (select coalesce(grinder_name_snapshot,'ไม่ระบุ') as name,count(*)::int as bags
     from done group by 1 order by 2 desc,1) g),'[]'::jsonb) as by_grinder,
   coalesce((select jsonb_agg(o) from (select ord.order_no,count(*)::int as bags,max(done.completed_at) as finished_at
     from done join coffee.orders ord on ord.id=done.order_id group by ord.order_no
     order by max(done.completed_at) desc limit 50) o),'[]'::jsonb) as orders_list`,[]);
 return NextResponse.json({daily:row});}
 catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
