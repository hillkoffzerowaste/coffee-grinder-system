import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { databaseError } from "@/lib/db";
import {transaction} from "@/lib/db";
import {isAdminEntity,parseAdminPayload} from "@/lib/admin-entities";
import {z} from "zod";
type Context={params:Promise<{entity:string;id:string}>};
async function update(request:Request,context:Context,disable:boolean) {
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;
 const {entity,id}=await context.params;if(!isAdminEntity(entity))return NextResponse.json({error:"ไม่พบประเภทข้อมูล"},{status:404});
 if(!z.uuid().safeParse(id).success)return NextResponse.json({error:"รหัสไม่ถูกต้อง"},{status:400});
 if(disable&&entity==="app_settings")return NextResponse.json({error:"การตั้งค่าระบบไม่รองรับการปิดใช้งาน"},{status:405});
 const parsed=parseAdminPayload(entity,disable?{active:false}:await request.json().catch(()=>null),true);
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลสำหรับบันทึกไม่ถูกต้อง"},{status:400});
 const fields=Object.keys(parsed.data),values=Object.entries(parsed.data).map(([k,v])=>k==="value"?JSON.stringify(v):v);
 try{const item=await transaction(async c=>{
 const item=(await c.query(`update coffee.${entity} set ${fields.map((k,i)=>k+"=$"+(i+1)+(k==="value"?"::jsonb":"")).join(",")} where id=$${fields.length+1} returning *`,[...values,id])).rows[0];
 if(item)await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values ($1,$2,$3,$4)",[auth.profile.id,disable?"DEACTIVATE":"UPDATE",entity,id]);
 return item;
 },auth.profile.id,true);
 return item?NextResponse.json({item}):NextResponse.json({error:"ไม่พบรายการ"},{status:404});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
export async function PATCH(request:Request,context:Context){return update(request,context,false);}
export async function DELETE(request:Request,context:Context){return update(request,context,true);}
