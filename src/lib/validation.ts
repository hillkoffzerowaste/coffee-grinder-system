import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(6).max(200),
  station: z.enum(["counter", "packing"]),
});

export const orderSchema = z.object({
  clientRequestId: z.uuid(),
  source: z.enum(["COUNTER", "PACKING_MANUAL"]),
  grinderUserId: z.uuid().optional(),
  note: z.string().trim().min(1).max(500).optional(),
  lines: z.array(z.object({
    clientLineId: z.string().min(1).max(100),
    productId: z.uuid(),
    productBarcode: z.string().regex(/^\d{4,32}$/),
    grindId: z.uuid().nullable(),
    grindBarcode: z.string().regex(/^\d{1,32}$/).nullable(),
    blendGroupId: z.string().min(1).max(100).optional(),
    mode: z.enum(["GROUND", "WHOLE_BEAN"]).optional(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(100)
    .refine((lines) => new Set(lines.map((line) => line.clientLineId)).size === lines.length, "Duplicate line identifiers")
    .refine((lines) => lines.reduce((total, line) => total + line.quantity, 0) <= 500, "Maximum 500 bags per order")
    .superRefine((lines, ctx) => {
      const groups = new Map<string, typeof lines>();
      for (const line of lines) {
        const group = line.blendGroupId ?? line.clientLineId;
        const members = groups.get(group) ?? [];
        members.push(line); groups.set(group, members);
      }
      for (const members of groups.values()) {
        const first = members[0];
        const mode = first.mode ?? "GROUND";
        for (const line of members) {
          const lineMode = line.mode ?? "GROUND";
          if (lineMode !== mode || (mode === "GROUND" && line.grindId !== first.grindId)) {
            ctx.addIssue({code:"custom",path:[line.clientLineId],message:"Blend group must use one process mode and grind"});
          }
          if (lineMode === "WHOLE_BEAN" && (line.grindId !== null || line.grindBarcode !== null)) {
            ctx.addIssue({code:"custom",path:[line.clientLineId],message:"Whole-bean line cannot include a grind"});
          }
          if (lineMode === "GROUND" && line.grindId === null) {
            ctx.addIssue({code:"custom",path:[line.clientLineId],message:"Ground line requires a grind"});
          }
        }
      }
    }),
});

export const batchStartSchema = z.object({
  clientRequestId:z.uuid(),orderId:z.uuid(),productBarcode:z.string().regex(/^\d{4,32}$/),blendGroupNo:z.number().int().min(1).optional(),
  grindId:z.uuid().nullable(),quantity:z.number().int().min(1).max(99),grinderUserId:z.uuid(),
}).strict();
export const batchCompleteSchema = z.object({clientRequestId:z.uuid(),batchId:z.uuid()}).strict();

export const transitionSchema = z.object({
  expectedStatus: z.enum(["QUEUED", "CLAIMED", "GRINDING", "BLOCKED"]),
  nextStatus: z.enum(["COMPLETED", "BLOCKED", "CANCELLED"]),
  grinderUserId: z.uuid().optional(),
  grindId: z.uuid().optional(),
}).superRefine((transition,ctx) => {
  const normal = transition.expectedStatus === "GRINDING" && transition.nextStatus === "COMPLETED";
  const adminOnly = ["BLOCKED","CANCELLED"].includes(transition.nextStatus)
    && transition.expectedStatus !== transition.nextStatus;
  if (!normal && !adminOnly) ctx.addIssue({code:"custom",message:"Invalid transition"});
});

// create_grinding_order ไม่มีที่เก็บหมายเหตุ ถ้าปล่อยผ่านจะหายเงียบ ๆ
export const counterNoteOnly = (order: { source: string; note?: string }) => order.source === "COUNTER" || order.note === undefined;

export const pendingOrderSchema = z.object({
  body: z.string(),
  lines: z.array(z.object({
    clientLineId: z.string(), quantity: z.number().int().min(1).max(99),
    product: z.object({id:z.uuid(),name:z.string(),sku:z.string(),size_grams:z.number().min(200),unit:z.string(),barcode:z.string()}),
    grind: z.object({id:z.uuid(),barcode:z.string().nullable(),grind_value:z.string()}).nullable(),
    blendGroupId: z.string().optional(), mode: z.enum(["GROUND", "WHOLE_BEAN"]).optional(),
  })).min(1).max(100),
}).superRefine((saved,ctx) => {
  try {
    const order = orderSchema.parse(JSON.parse(saved.body));
    const lines = saved.lines.map(line => ({clientLineId:line.clientLineId,productId:line.product.id,productBarcode:line.product.barcode,grindId:line.grind?.id??null,grindBarcode:line.grind?.barcode??null,blendGroupId:line.blendGroupId,mode:line.mode,quantity:line.quantity}));
    if (JSON.stringify(order.lines) !== JSON.stringify(lines)) throw new Error("Draft mismatch");
  } catch { ctx.addIssue({code:"custom",message:"Invalid pending order"}); }
});
