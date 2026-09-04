import {NextResponse} from "next/server";
import {requireApiUser} from "@/lib/auth";
import {readRows,databaseError} from "@/lib/db";
import {batchStartSchema} from "@/lib/validation";
export async function POST(request:Request){
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const parsed=batchStartSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลสินค้า เบอร์บด จำนวน หรือคนบดไม่ถูกต้อง"},{status:400});
 const p=parsed.data;
 try{const [row]=await readRows(auth.profile.id,"select coffee.start_scan_batch($1,$2,$3,$4,$5,$6) as result",[p.clientRequestId,p.orderId,p.productBarcode,p.grindId,p.quantity,p.grinderUserId]);return NextResponse.json({batch:row.result});}
 catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
