import { NextResponse } from "next/server";
import { z } from "zod";
import { authEmail } from "@/lib/env";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  username: z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["counter", "packer", "admin"]),
  station: z.enum(["counter", "packing", "both"]),
}).refine(({ role, station }) => station === "both" || station === (role === "counter" ? "counter" : "packing"), "Role and station do not match");

export async function GET() {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("profiles").select("id,username,display_name,role,station,active,created_at").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ข้อมูลผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: authEmail(parsed.data.username),
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { username: parsed.data.username },
  });
  if (error || !data.user) return NextResponse.json({ error: error?.message || "สร้างผู้ใช้ไม่สำเร็จ" }, { status: 409 });
  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    username: parsed.data.username.toLowerCase(),
    display_name: parsed.data.displayName,
    role: parsed.data.role,
    station: parsed.data.station,
    active: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 409 });
  }
  return NextResponse.json({ id: data.user.id }, { status: 201 });
}
