import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { hashToken } from "@/lib/password";
import { sessionCookie,sessionOptions } from "@/lib/auth";
export async function POST() {
  const store=await cookies(),token=store.get(sessionCookie)?.value;
  if(token) {
    try {await pool().query("update coffee.sessions set revoked_at=now() where token_hash=$1",[hashToken(token)]);}
    catch {return NextResponse.json({error:"ออกจากระบบไม่สำเร็จ กรุณาลองใหม่"},{status:503});}
  }
  store.set(sessionCookie,"",{...sessionOptions,maxAge:0});
  return NextResponse.json({ok:true});
}
