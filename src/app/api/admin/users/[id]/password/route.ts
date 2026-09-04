import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { transaction, databaseError } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { resetPasswordSchema, resetAccountPassword } from "@/lib/reset-password";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(["admin"]);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "รหัสผ่านต้องมี 8–200 ตัวอักษร และยืนยันรหัสผ่านให้ตรงกัน" }, { status: 400 });
  }
  try {
    const hash = await hashPassword(parsed.data.password);
    const found = await transaction(client => resetAccountPassword(client, auth.profile.id, id, hash), auth.profile.id, true);
    if (!found) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    return NextResponse.json({ ok: true, requiresLogin: id === auth.profile.id });
  } catch (error) {
    const result = databaseError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
