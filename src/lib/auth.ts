import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";
import { pool } from "./db";
import { hasDatabaseEnv } from "./env";
import { hashToken } from "./password";
import { canUseStation } from "./permissions";
import type { AppRole, Profile } from "./types";
export { canUseStation } from "./permissions";
export const sessionCookie = "coffee_session";
export const sessionOptions = {httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax" as const,path:"/",maxAge:31536000};
export const currentProfile = cache(async (): Promise<Profile | null> => {
  if (!hasDatabaseEnv()) return null;
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await pool().query<Profile>(`select p.id,p.username,p.display_name,p.role,p.station,p.active
    from coffee.sessions s join coffee.profiles p on p.id=s.user_id
    where s.token_hash=$1 and s.revoked_at is null and p.active`,[hashToken(token)]);
  return result.rows[0] ?? null;
});
export async function requireApiUser(roles?: AppRole[]) {
  if (!hasDatabaseEnv()) return {error:NextResponse.json({error:"ระบบยังไม่พร้อมเชื่อมต่อฐานข้อมูล กรุณาติดต่อผู้ดูแล"},{status:503})};
  let profile: Profile | null;
  try { profile = await currentProfile(); }
  catch { return {error:NextResponse.json({error:"เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่"},{status:503})}; }
  if (!profile) return {error:NextResponse.json({error:"UNAUTHORIZED"},{status:401})};
  if ((!canUseStation(profile,"counter") && !canUseStation(profile,"packing")) || (roles && !roles.includes(profile.role))) return {error:NextResponse.json({error:"FORBIDDEN"},{status:403})};
  return {profile};
}
