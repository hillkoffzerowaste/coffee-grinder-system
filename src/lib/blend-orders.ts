import type { DraftLine, GrindLookup, ProductLookup } from "@/lib/types";

export type BlendMode = "GROUND" | "WHOLE_BEAN";
// ชุดคือป้ายงานของห้องแพ็ค ไม่ใช่สูตรกาแฟ หนึ่งชุดจึงมีได้หลาย SKU และหลายเบอร์บด
// แต่ต้องเป็นวิธีเตรียมเดียว เพราะงานเมล็ดกับงานบดเดินคนละเครื่องคนละคิว
export type BlendGroupDraft = { id: string; mode: BlendMode; grind: GrindLookup | null };
export type BlendDraftLine = DraftLine & { blendGroupId: string; mode: BlendMode };
export type DraftGroup = BlendGroupDraft & { lines: BlendDraftLine[] };

export function canJoinBlendGroup(group: BlendGroupDraft, mode: BlendMode): boolean {
  return group.mode === mode;
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

// ลำดับชุดที่หน้าร้านเห็นต้องเท่ากับ blend_group_no ที่ create_order แจก ซึ่งไล่ตามลำดับที่
// blendGroupId โผล่ครั้งแรกใน payload การส่งแบบไล่ทีละชุดจึงเป็นเงื่อนไขของ "ชุดที่ 1 = ชุดที่ 1"
export function flattenGroups(groups: DraftGroup[]): BlendDraftLine[] {
  return groups.flatMap((group) => group.lines);
}
export function groupsFromLines(lines: BlendDraftLine[]): DraftGroup[] {
  const groups: DraftGroup[] = [];
  for (const line of lines) {
    const id = line.blendGroupId ?? line.clientLineId;
    const mode = line.mode ?? "GROUND";
    let group = groups.find((item) => item.id === id);
    if (!group) { group = { id, mode, grind: null, lines: [] }; groups.push(group); }
    group.lines.push(line);
    // เบอร์ล่าสุดของชุดคือค่าตั้งต้นของรายการถัดไป ไม่ใช่กติกาที่บังคับทั้งชุด
    group.grind = mode === "WHOLE_BEAN" ? null : line.grind;
  }
  return groups;
}
export function groupBags(group: DraftGroup): number {
  return group.lines.reduce((sum, line) => sum + line.quantity, 0);
}
export function groupSkuCount(group: DraftGroup): number {
  return new Set(group.lines.map((line) => line.product.sku)).size;
}
// หนึ่งชุดมีหลายเบอร์ได้ ป้ายจึงต้องบอกว่าคละเบอร์อะไรบ้าง ไม่ใช่โชว์เบอร์แรกแล้วจบ
export function preparationLabel(mode: BlendMode | null | undefined, grindValues: (string | null | undefined)[]): string {
  if (mode === "WHOLE_BEAN") return "เมล็ด";
  const unique = [...new Set(grindValues.filter((value): value is string => !!value))];
  if (!unique.length) return "ยังไม่เลือกเบอร์บด";
  return unique.length === 1 ? `บดเบอร์ ${unique[0]}` : `บดคละเบอร์ ${unique.join(", ")}`;
}
export function groupPreparationLabel(group: DraftGroup): string {
  if (group.mode === "WHOLE_BEAN") return "เมล็ด";
  if (!group.lines.length) return group.grind ? `บดเบอร์ ${group.grind.grind_value}` : "ยังไม่เลือกเบอร์บด";
  return preparationLabel(group.mode, group.lines.map((line) => line.grind?.grind_value));
}

// 250 g บดถูกหยิบสลับกับขนาดอื่นบ่อย ทั้งหน้าร้านและห้องแพ็คจึงต้องเห็นต่างทันที
export function isGround250(sizeGrams: number, mode: BlendMode | null | undefined): boolean {
  return sizeGrams === 250 && (mode ?? "GROUND") === "GROUND";
}
