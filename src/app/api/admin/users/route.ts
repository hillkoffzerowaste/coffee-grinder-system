import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import {transaction} from "@/lib/db";
import {hashPassword} from "@/lib/password";
import {z} from "zod";
const schema = z.object({
  username: z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["counter", "packer", "admin"]),
  station: z.enum(["counter", "packing", "both"]),
}).refine(({ role, station }) => station === "both" || station === (role === "counter" ? "counter" : "packing"), "Role and station do not match");


export async function GET(){
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;
 try{return NextResponse.json({items:await readRows(auth.profile.id,"select id,username,display_name,role,station,active,created_at from coffee.profiles order by created_at desc")});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
export async function POST(request:Request){
 const auth=await requireApiUser(["admin"]);if(auth.error)return auth.error;
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"ข้อมูลผู้ใช้ไม่ถูกต้อง"},{status:400});
 try{const hash=await hashPassword(parsed.data.password);
 const id=await transaction(async c=>{
 const {rows:[account]}=await c.query("insert into coffee.accounts(password_hash) values ($1) returning id",[hash]);
 await c.query("insert into coffee.profiles(id,username,display_name,role,station) values ($1,$2,$3,$4,$5)",[account.id,parsed.data.username.toLowerCase(),parsed.data.displayName,parsed.data.role,parsed.data.station]);
 await c.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values ($1,'CREATE','profiles',$2)",[auth.profile.id,account.id]);
 return account.id;
 },auth.profile.id,true);return NextResponse.json({id},{status:201});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
