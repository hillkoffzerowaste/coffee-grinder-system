import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { databaseError, readRows } from "@/lib/db";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;const {id}=await params;const body=z.object({reason:z.string().trim().min(1).max(500)}).safeParse(await request.json().catch(()=>null));if(!z.uuid().safeParse(id).success||!body.success)return NextResponse.json({error:"กรอกเหตุผลยกเลิกให้ครบถ้วน"},{status:400});
 try{const [row]=await readRows<{result:unknown}>(auth.profile.id,"select coffee.admin_cancel_order($1,$2) result",[id,body.data.reason]);return NextResponse.json({order:row.result});}catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
