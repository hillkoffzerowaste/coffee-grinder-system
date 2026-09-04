import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasPublicEnv, publicEnv } from "@/lib/env";
import { authCookieOptions } from "@/lib/supabase/cookie-options";
import { isAllowedMutation } from "@/lib/request-origin";

export async function proxy(request: NextRequest) {
  if (!isAllowedMutation(request)) return NextResponse.json({ error: "คำขอมาจากเว็บไซต์ที่ไม่ได้รับอนุญาต" }, { status: 403 });
  let response = NextResponse.next({ request });
  if (request.nextUrl.pathname.startsWith("/api/") || !hasPublicEnv()) return response;
  const env = publicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  // Refresh cookies before Server Components run; authorization remains in routes.
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/counter/:path*", "/packing/:path*", "/admin/:path*", "/api/:path*"] };
