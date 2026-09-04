import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";

export async function GET(request:Request) {
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const status=new URL(request.url).searchParams.get("status");
 const statuses=status?[status]:["QUEUED","CLAIMED","GRINDING","GROUND","PACKING","BLOCKED"];
 try {const jobs=await readRows(auth.profile.id,"select b.id,b.bag_no,b.queue_seq,b.status,b.product_name_snapshot,b.sku_snapshot,b.size_grams_snapshot,b.grind_value_snapshot,b.product_barcode_snapshot,b.grinder_name_snapshot,b.created_at,json_build_object('order_no',o.order_no) as orders from coffee.bags b join coffee.orders o on o.id=b.order_id where b.status=any($1::text[]) order by b.queue_seq limit 100",[statuses]);
 const [queue]=await readRows(auth.profile.id,"select coalesce(max(queue_seq),0)::text as latest,count(*) filter (where status=$1)::int as queued from coffee.bags",["QUEUED"]);
 return NextResponse.json({jobs,latestQueueSeq:queue.latest,queuedCount:queue.queued});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
