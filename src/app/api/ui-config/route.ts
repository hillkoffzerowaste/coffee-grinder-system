import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { readRows } from "@/lib/db";
import { defaultUiConfig, parseUiConfig } from "@/lib/ui-config";

export async function GET() {
  const auth = await requireApiUser(); if (auth.error) return auth.error;
  try {
    const [row] = await readRows<{config: unknown}>(auth.profile.id,"select config from coffee.ui_config_versions where status='PUBLISHED' order by published_at desc nulls last limit 1");
    const parsed = row && parseUiConfig(row.config);
    return NextResponse.json({ config: parsed?.success ? parsed.data : defaultUiConfig });
  } catch { return NextResponse.json({ config: defaultUiConfig }); }
}
