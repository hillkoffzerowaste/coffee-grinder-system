import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { databaseError, transaction } from "@/lib/db";
import { z } from "zod";

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}) {
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;const {id}=await params;if(!z.uuid().safeParse(id).success)return NextResponse.json({error:"รหัสฉบับตั้งค่าไม่ถูกต้อง"},{status:400});
 try {const version=await transaction(async c=>{const draft=(await c.query("select id from coffee.ui_config_versions where id=$1 and status='DRAFT' for update",[id])).rows[0];if(!draft)throw new Error("DRAFT_NOT_FOUND");await c.query("update coffee.ui_config_versions set status='ARCHIVED' where status='PUBLISHED'");const row=(await c.query("update coffee.ui_config_versions set status='PUBLISHED',published_by=$2,published_at=now() where id=$1 returning id,status,config,published_at",[id,auth.profile.id])).rows[0];await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values($1,'PUBLISH','ui_config_versions',$2)",[auth.profile.id,id]);return row;},auth.profile.id,true);return NextResponse.json({version});}
 catch(error){if(error instanceof Error&&error.message==='DRAFT_NOT_FOUND')return NextResponse.json({error:"ไม่พบฉบับร่างที่เผยแพร่ได้"},{status:404});const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
