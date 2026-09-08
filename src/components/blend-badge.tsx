import type { BlendMode } from "@/lib/blend-orders";

// ห้องแพ็คต้องแยกชุดผสมแบบบดออกจากกาแฟบดเดิมให้ได้จากระยะไกล สีจึงผูกกับทั้งจำนวน SKU และวิธีเตรียม
export function BlendBadge({ skuCount, mode }: { skuCount: number; mode: BlendMode | null | undefined }) {
  const beans = mode === "WHOLE_BEAN";
  if (skuCount <= 1) return <span className="status">{beans ? "เมล็ดเดี่ยว" : "กาแฟบดเดี่ยว"}</span>;
  return <span className={`status ${beans ? "flag-blend-bean" : "flag-blend"}`}>{beans ? "กาแฟผสมเมล็ด" : "กาแฟผสมบด"} {skuCount} SKU</span>;
}
