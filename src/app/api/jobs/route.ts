import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import {z} from "zod";

export async function GET(request:Request) {
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const params=new URL(request.url).searchParams,status=params.get("status");
 const scan=params.get("scan"),orderId=params.get("orderId"),batch=params.get("batch");
 if((scan&&!/^(?:\d{1,32}|[a-f0-9-]{36})$/i.test(scan))||(orderId&&!z.uuid().safeParse(orderId).success)||(batch&&!z.uuid().safeParse(batch).success))return NextResponse.json({error:"ตัวกรองไม่ถูกต้อง"},{status:400});
 const statuses=status?[status]:["QUEUED","CLAIMED","GRINDING","BLOCKED"];
 try {const rows=await readRows(auth.profile.id,"select b.id,b.order_id,b.grind_id,b.claimed_by,b.grinding_batch_id,b.bag_no,b.queue_seq,b.status,b.product_name_snapshot,b.sku_snapshot,b.size_grams_snapshot,b.grind_value_snapshot,b.product_barcode_snapshot,b.grinder_name_snapshot,b.created_at,json_build_object('order_no',o.order_no) as orders from coffee.bags b join coffee.orders o on o.id=b.order_id where b.status=any($1::text[]) and ($2::text is null or b.product_barcode_snapshot=$2 or b.queue_seq::text=$2 or b.id::text=$2) and ($3::uuid is null or b.order_id=$3) and ($4::uuid is null or b.grinding_batch_id=$4) order by b.queue_seq limit 1001",[statuses,scan,orderId,batch]);
 const [queue]=await readRows(auth.profile.id,"select coalesce(max(queue_seq),0)::text as latest,count(*) filter (where status=$1)::int as queued from coffee.bags",["QUEUED"]);
 return NextResponse.json({jobs:rows.slice(0,1000),hasMore:rows.length>1000,latestQueueSeq:queue.latest,queuedCount:queue.queued});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
