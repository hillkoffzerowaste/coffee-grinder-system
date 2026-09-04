import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { transitionSchema } from "@/lib/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(["packer", "admin"]);
  if (auth.error) return auth.error;
  const parsed = transitionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "คำสั่งเปลี่ยนสถานะไม่ถูกต้อง" }, { status: 400 });
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("transition_bag", {
    p_bag_id: id,
    p_expected_status: parsed.data.expectedStatus,
    p_next_status: parsed.data.nextStatus,
    p_grinder_user_id: parsed.data.grinderUserId ?? null,
    p_grind_id: parsed.data.grindId ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ job: data });
}
