import {NextResponse} from "next/server";
import {requireApiUser} from "@/lib/auth";
import {readRows,databaseError} from "@/lib/db";
import {blendBatchStartSchema} from "@/lib/packing-validation";

export async function POST(request:Request){
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const parsed=blendBatchStartSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลชุดกาแฟผสม จำนวน หรือคนบดไม่ถูกต้อง"},{status:400});
 const p=parsed.data;
 try{
  const [row]=await readRows(auth.profile.id,"select coffee.start_blend_batch($1,$2,$3,$4,$5) as result",[p.clientRequestId,p.orderId,p.blendGroupNo,p.quantity,p.grinderUserId]);
  return NextResponse.json({batch:row.result});
 }catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
