import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import { validDay } from "@/lib/validation";
export async function GET(request:Request){
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const day=new URL(request.url).searchParams.get("day");
 if(day!==null&&!validDay(day))return NextResponse.json({error:"วันที่ไม่ถูกต้อง"},{status:400});
 // ขอบวันต้องเป็นเที่ยงคืนตามเวลาไทย ไม่ใช่ UTC ไม่งั้นกะเช้าจะเห็นงานของเมื่อวานปนมา
 try{const [row]=await readRows(auth.profile.id,`with picked as (
   select coalesce($1::date, (now() at time zone 'Asia/Bangkok')::date) as day),
  bounds as (select day, (day::timestamp) at time zone 'Asia/Bangkok' as from_ts,
   ((day + 1)::timestamp) at time zone 'Asia/Bangkok' as to_ts from picked),
  done as (select b.* from coffee.bags b, bounds x
   where b.status='COMPLETED' and b.completed_at >= x.from_ts and b.completed_at < x.to_ts)
  select (select to_char(day,'YYYY-MM-DD') from bounds) as day,
   (select count(*) from done)::int as bags,
   coalesce((select sum(size_grams_snapshot) from done),0)::int as grams,
   (select count(distinct order_id) from done)::int as orders,
   coalesce((select jsonb_agg(g) from (select coalesce(grinder_name_snapshot,'ไม่ระบุ') as name,count(*)::int as bags
     from done group by 1 order by 2 desc,1) g),'[]'::jsonb) as by_grinder,
   coalesce((select jsonb_agg(o) from (select ord.order_no,count(*)::int as bags,max(done.completed_at) as finished_at
     from done join coffee.orders ord on ord.id=done.order_id group by ord.order_no
     order by max(done.completed_at) desc limit 50) o),'[]'::jsonb) as orders_list`,[day]);
 return NextResponse.json({daily:row});}
 catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
