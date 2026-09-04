import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows, databaseError } from "@/lib/db";

export async function GET() {
 const auth=await requireApiUser();if(auth.error)return auth.error;
 try { const [grinds,grinders]=await Promise.all([
 readRows(auth.profile.id,"select id,grind_value,barcode from coffee.grind_size_codes where active order by sort_order"),
 readRows(auth.profile.id,"select id,name from coffee.grinder_users where active order by sort_order")]);
 return NextResponse.json({grinds,grinders}); } catch(error) { const e=databaseError(error); return NextResponse.json({error:e.message},{status:e.status}); }
}
