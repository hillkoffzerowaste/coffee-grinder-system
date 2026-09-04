export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(typeof payload?.error === "string" ? payload.error : "เกิดข้อผิดพลาดจากระบบ", response.status);
  if (!payload || typeof payload !== "object") throw new ApiError("ข้อมูลตอบกลับไม่สมบูรณ์ กรุณาลองใหม่", 502);
  return payload as T;
}
