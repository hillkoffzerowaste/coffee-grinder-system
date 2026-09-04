import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminEntity, pickAllowed } from "@/lib/admin-entities";

export async function GET(_: Request, context: { params: Promise<{ entity: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).select("*").order("created_at", { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

export async function POST(request: Request, context: { params: Promise<{ entity: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const payload = pickAllowed(entity, body);
  if (!Object.keys(payload).length) return NextResponse.json({ error: "ไม่มีข้อมูลสำหรับบันทึก" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ item: data }, { status: 201 });
}
