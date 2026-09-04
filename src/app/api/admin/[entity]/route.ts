import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import {transaction} from "@/lib/db";
import {isAdminEntity,parseAdminPayload} from "@/lib/admin-entities";

export async function GET(_:Request,context:{params:Promise<{entity:string}>}) {
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;
 const {entity}=await context.params;if(!isAdminEntity(entity))return NextResponse.json({error:"ไม่พบประเภทข้อมูล"},{status:404});
 try{return NextResponse.json({items:await readRows(auth.profile.id,`select * from coffee.${entity} order by created_at desc limit 500`)});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
export async function POST(request:Request,context:{params:Promise<{entity:string}>}) {
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;
 const {entity}=await context.params;if(!isAdminEntity(entity))return NextResponse.json({error:"ไม่พบประเภทข้อมูล"},{status:404});
 const parsed=parseAdminPayload(entity,await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลสำหรับบันทึกไม่ถูกต้อง"},{status:400});
 const fields=Object.keys(parsed.data), values=Object.entries(parsed.data).map(([k,v])=>k==="value"?JSON.stringify(v):v);
 try {const item=await transaction(async c=>{
 const item=(await c.query(`insert into coffee.${entity} (${fields.join(",")}) values (${fields.map((k,i)=>"$"+(i+1)+(k==="value"?"::jsonb":"")).join(",")}) returning *`,values)).rows[0];
 await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values ($1,'CREATE',$2,$3)",[auth.profile.id,entity,item.id]);
 return item;
 },auth.profile.id,true);return NextResponse.json({item},{status:201});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
