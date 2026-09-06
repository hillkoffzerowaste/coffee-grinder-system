type SlaInput = { totalGrams: number; startedAt: string | null; finishedAt?: string | null; now?: string | Date };
export type SlaTone = "ok" | "warn" | "danger";
export type OrderSla = { elapsedSeconds: number; targetSeconds: number; tone: SlaTone };

export function orderSla({ totalGrams, startedAt, finishedAt, now = new Date() }: SlaInput): OrderSla | null {
  const started = Date.parse(startedAt ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(totalGrams) || totalGrams <= 0) return null;
  const ended = finishedAt ? Date.parse(finishedAt) : new Date(now).getTime();
  if (!Number.isFinite(ended)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((ended - started) / 1000));
  const targetSeconds = Math.round(totalGrams * 120 / 500);
  const ratio = targetSeconds ? elapsedSeconds / targetSeconds : 0;
  return { elapsedSeconds, targetSeconds, tone: ratio >= 1 ? "danger" : ratio >= .75 ? "warn" : "ok" };
}
