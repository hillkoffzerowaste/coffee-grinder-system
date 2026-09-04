import { NextResponse, type NextRequest } from "next/server";
import { isAllowedMutation } from "@/lib/request-origin";
export function proxy(request: NextRequest) {
  if (!isAllowedMutation(request)) return NextResponse.json({error:"คำขอมาจากเว็บไซต์ที่ไม่ได้รับอนุญาต"},{status:403});
  const response = NextResponse.next();
  response.headers.set("Cache-Control","private, no-store");
  return response;
}
export const config = {matcher:["/counter/:path*","/packing/:path*","/admin/:path*","/api/:path*"]};
