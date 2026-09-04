import { NextResponse } from "next/server";
import { currentProfile } from "@/lib/auth";

export async function GET() {
  const profile = await currentProfile();
  if (!profile) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ profile });
}
