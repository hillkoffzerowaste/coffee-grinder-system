import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminEntity, pickAllowed } from "@/lib/admin-entities";

export async function PATCH(request: Request, context: { params: Promise<{ entity: string; id: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity, id } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  const payload = pickAllowed(entity, await request.json().catch(() => ({})));
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).update(payload).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ item: data });
}

export async function DELETE(_: Request, context: { params: Promise<{ entity: string; id: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { entity, id } = await context.params;
  if (!isAdminEntity(entity)) return NextResponse.json({ error: "ไม่รองรับข้อมูลประเภทนี้" }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(entity).update({ active: false }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ item: data });
}
