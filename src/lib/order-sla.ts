export const DEFAULT_SLA_GRAMS = 500;
export const DEFAULT_SLA_SECONDS = 180;
type SlaInput = { totalGrams: number; queueAheadGrams?: number | null; slaGrams?: number; slaSeconds?: number; queuedAt?: string | null; startedAt?: string | null; finishedAt?: string | null; now?: string | Date };
export type SlaTone = "ok" | "warn" | "danger";
export type OrderSla = { elapsedSeconds: number; targetSeconds: number; tone: SlaTone };

// งานที่รอคิวอยู่ข้างหน้าต้องบดให้เสร็จก่อนเสมอ เวลาของคิวก่อนหน้าจึงเป็นส่วนหนึ่งของเป้า
// ไม่ใช่ความช้าของออเดอร์นี้ ไม่งั้นออเดอร์ที่ต่อคิวยาวจะขึ้นแดงตั้งแต่ยังไม่มีใครแตะ
export function orderSla({ totalGrams, queueAheadGrams, slaGrams = DEFAULT_SLA_GRAMS, slaSeconds = DEFAULT_SLA_SECONDS, queuedAt, startedAt, finishedAt, now = new Date() }: SlaInput): OrderSla | null {
  const started = Date.parse(queuedAt ?? startedAt ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(totalGrams) || totalGrams <= 0) return null;
  const ended = finishedAt ? Date.parse(finishedAt) : new Date(now).getTime();
  if (!Number.isFinite(ended)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((ended - started) / 1000));
  const ahead = Number.isFinite(queueAheadGrams) ? Math.max(0, queueAheadGrams as number) : 0;
  const baselineGrams = Number.isFinite(slaGrams) && slaGrams > 0 ? slaGrams : DEFAULT_SLA_GRAMS;
  const baselineSeconds = Number.isFinite(slaSeconds) && slaSeconds > 0 ? slaSeconds : DEFAULT_SLA_SECONDS;
  const targetSeconds = Math.round((totalGrams + ahead) * baselineSeconds / baselineGrams);
  const ratio = targetSeconds ? elapsedSeconds / targetSeconds : 0;
  return { elapsedSeconds, targetSeconds, tone: ratio >= 1 ? "danger" : ratio >= .75 ? "warn" : "ok" };
}

export const slaClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
