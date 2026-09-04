import {NextResponse} from "next/server";
import {requireApiUser} from "@/lib/auth";
import {readRows,databaseError} from "@/lib/db";
import {batchCompleteSchema} from "@/lib/validation";
export async function POST(request:Request){
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const parsed=batchCompleteSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลชุดงานไม่ถูกต้อง"},{status:400});
 try{const [row]=await readRows(auth.profile.id,"select coffee.complete_scan_batch($1,$2) as result",[parsed.data.clientRequestId,parsed.data.batchId]);return NextResponse.json({batch:row.result});}
 catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
