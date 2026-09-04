import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { transaction, databaseError } from "@/lib/db";
import { hasDatabaseEnv } from "@/lib/env";
import { checkPassword, hashToken } from "@/lib/password";
import { loginSchema } from "@/lib/validation";
import { canUseStation, sessionCookie, sessionOptions } from "@/lib/auth";
import type { Profile } from "@/lib/types";
export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"ข้อมูลเข้าสู่ระบบไม่ถูกต้อง"},{status:400});
  if (!hasDatabaseEnv()) return NextResponse.json({error:"ระบบยังไม่พร้อมเชื่อมต่อฐานข้อมูล กรุณาติดต่อผู้ดูแล"},{status:503});
  try {
    const username = parsed.data.username.toLowerCase();
    const store = await cookies(), token = randomBytes(32).toString("hex");
    const result = await transaction(async client => {
      const key = hashToken("login:"+username);
      const attempt = await client.query<{attempts:number}>(`insert into coffee.login_attempts(key,attempts,reset_at) values($1,1,now()+interval '10 minutes')
        on conflict(key) do update set attempts=case when login_attempts.reset_at<now() then 1 else login_attempts.attempts+1 end,
        reset_at=case when login_attempts.reset_at<now() then now()+interval '10 minutes' else login_attempts.reset_at end returning attempts`,[key]);
      if (attempt.rows[0].attempts > 15) return {error:"ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 10 นาที",status:429};
      const user = (await client.query<Profile & {password_hash:string}>(`select p.*,a.password_hash from coffee.profiles p join coffee.accounts a on a.id=p.id where p.username=$1 for share of p,a`,[username])).rows[0];
      const dummy = '00000000000000000000000000000000:'+'00'.repeat(64);
      const valid = await checkPassword(parsed.data.password,user?.password_hash ?? dummy);
      if (!user || !valid || !user.active) return {error:"Username หรือ Password ไม่ถูกต้อง",status:401};
      if (!canUseStation(user,parsed.data.station)) return {error:"บัญชีนี้ไม่มีสิทธิ์ใช้สถานีที่เลือก",status:403};
      await client.query("delete from coffee.login_attempts where key=$1",[key]);
      const previous = store.get(sessionCookie)?.value;
      if (previous) await client.query("update coffee.sessions set revoked_at=now() where token_hash=$1",[hashToken(previous)]);
      await client.query("insert into coffee.sessions(token_hash,user_id) values($1,$2)",[hashToken(token),user.id]);
      const profile: Profile = {id:user.id,username:user.username,display_name:user.display_name,role:user.role,station:user.station,active:user.active};
      return {profile};
    });
    if (result.error) return NextResponse.json({error:result.error},{status:result.status});
    store.set(sessionCookie,token,sessionOptions);
    return NextResponse.json({profile:result.profile,destination:parsed.data.station === "counter" ? "/counter" : "/packing"});
  } catch(e) { const error=databaseError(e); return NextResponse.json({error:error.message},{status:error.status}); }
}
