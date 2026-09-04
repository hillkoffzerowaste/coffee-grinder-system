import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";
import {z} from "zod";
import {transitionSchema} from "@/lib/validation";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const auth=await requireApiUser(["packer","admin"]);if(auth.error)return auth.error;
 const {id}=await context.params;
 const parsed=transitionSchema.safeParse(await request.json().catch(()=>null));
 if(!z.uuid().safeParse(id).success||!parsed.success)return NextResponse.json({error:"คำสั่งเปลี่ยนสถานะไม่ถูกต้อง"},{status:400});
 try {const [row]=await readRows(auth.profile.id,"select coffee.transition_bag($1,$2,$3,$4,$5) as result",[id,parsed.data.expectedStatus,parsed.data.nextStatus,parsed.data.grinderUserId??null,parsed.data.grindId??null]);
 return NextResponse.json({job:row.result});} catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
