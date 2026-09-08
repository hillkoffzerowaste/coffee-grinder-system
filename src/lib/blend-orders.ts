import type { DraftLine, GrindLookup, ProductLookup } from "@/lib/types";

export type BlendMode = "GROUND" | "WHOLE_BEAN";
export type BlendGroupDraft = { id: string; mode: BlendMode; grind: GrindLookup | null };
export type BlendDraftLine = DraftLine & { blendGroupId: string; mode: BlendMode };

export function canJoinBlendGroup(group: BlendGroupDraft, mode: BlendMode, grind: GrindLookup | null): boolean {
  return group.mode === mode && (mode === "WHOLE_BEAN" || group.grind?.id === grind?.id);
}
export function mergeBlendLine(lines: BlendDraftLine[], line: BlendDraftLine): BlendDraftLine[] {
  const existing = lines.find((item) => item.blendGroupId === line.blendGroupId && item.product.id === line.product.id && item.mode === line.mode && item.grind?.id === line.grind?.id);
  if (!existing) return [...lines, line];
  return lines.map((item) => item === existing ? { ...item, quantity: item.quantity + line.quantity } : item);
}
export function blendLineSummary(lines: BlendDraftLine[]) {
  return [...new Set(lines.map((line) => line.blendGroupId))].map((groupId) => {
    const members = lines.filter((line) => line.blendGroupId === groupId);
    const first = members[0];
    return { groupId, mode: first.mode, grind: first.grind, total: members.reduce((sum, line) => sum + line.quantity, 0), lines: members };
  });
}
export function productLine(product: ProductLookup, blendGroupId: string, mode: BlendMode, grind: GrindLookup | null, quantity: number, clientLineId: string): BlendDraftLine {
  return { clientLineId, product, blendGroupId, mode, grind, quantity };
}

// 250 g บดถูกหยิบสลับกับขนาดอื่นบ่อย ทั้งหน้าร้านและห้องแพ็คจึงต้องเห็นต่างทันที
export function isGround250(sizeGrams: number, mode: BlendMode | null | undefined): boolean {
  return sizeGrams === 250 && (mode ?? "GROUND") === "GROUND";
}
