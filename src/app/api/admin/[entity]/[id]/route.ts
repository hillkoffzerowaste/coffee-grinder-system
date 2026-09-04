import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminEntity, parseAdminPayload } from "@/lib/admin-entities";
import { z } from "zod";

export async function PATCH(request: Request, context: { params: Promise<{ entity: string; id: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity, id } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "รหัสรายการไม่ถูกต้อง" }, { status: 400 });
  const parsed = parseAdminPayload(entity, await request.json().catch(() => null), true);
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลสำหรับบันทึกไม่ถูกต้อง" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).update(parsed.data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ item: data });
}

export async function DELETE(_: Request, context: { params: Promise<{ entity: string; id: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity, id } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "รหัสรายการไม่ถูกต้อง" }, { status: 400 });
  if (entity === "app_settings") return NextResponse.json({ error: "การตั้งค่าระบบไม่รองรับการปิดใช้งาน" }, { status: 405 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).update({ active: false }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ item: data });
}
