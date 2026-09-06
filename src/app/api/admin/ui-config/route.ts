import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { databaseError, transaction } from "@/lib/db";
import { parseUiConfig } from "@/lib/ui-config";

export async function GET() {
  const auth=await requireApiUser(["admin"]); if(auth.error)return auth.error;
  try { const versions=await transaction(async c=>(await c.query("select id,status,config,created_at,published_at from coffee.ui_config_versions order by created_at desc limit 20")).rows,auth.profile.id,true); return NextResponse.json({versions}); }
  catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
export async function POST(request:Request) {
  const auth=await requireApiUser(["admin"]); if(auth.error)return auth.error;
  const parsed=parseUiConfig((await request.json().catch(()=>null))?.config); if(!parsed.success)return NextResponse.json({error:"รูปแบบการตั้งค่าหน้าจอไม่ปลอดภัยหรือไม่ถูกต้อง"},{status:400});
  try {const version=await transaction(async c=>{const row=(await c.query("insert into coffee.ui_config_versions(status,config,created_by) values ('DRAFT',$1::jsonb,$2) returning id,status,config,created_at",[JSON.stringify(parsed.data),auth.profile.id])).rows[0];await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id,details) values($1,'CREATE_DRAFT','ui_config_versions',$2,$3::jsonb)",[auth.profile.id,row.id,JSON.stringify({safeConfig:true})]);return row;},auth.profile.id,true);return NextResponse.json({version},{status:201});}
  catch(error){const e=databaseError(error);return NextResponse.json({error:e.message},{status:e.status});}
}
