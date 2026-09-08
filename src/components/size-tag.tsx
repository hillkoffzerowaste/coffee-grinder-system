import { isGround250, type BlendMode } from "@/lib/blend-orders";

export function SizeTag({ grams, mode, big }: { grams: number; mode: BlendMode | null | undefined; big?: boolean }) {
  if (!isGround250(grams, mode)) return <>{grams} g</>;
  return <span className={big ? "product-size flag-250" : "status flag-250"}>{grams} g บด</span>;
}
