export function BlendBadge({ skuCount }: { skuCount: number }) {
  if (skuCount <= 1) return <span className="status">กาแฟบดเดี่ยว</span>;
  return <span className="status flag-blend">กาแฟผสม {skuCount} SKU</span>;
}
