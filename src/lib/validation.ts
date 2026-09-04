import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(6).max(200),
  station: z.enum(["counter", "packing"]),
});

export const orderSchema = z.object({
  clientRequestId: z.uuid(),
  source: z.enum(["COUNTER", "PACKING_MANUAL"]),
  lines: z.array(z.object({
    clientLineId: z.string().min(1).max(100),
    productId: z.uuid(),
    productBarcode: z.string().regex(/^\d{4,32}$/),
    grindId: z.uuid(),
    grindBarcode: z.string().regex(/^\d{1,32}$/),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(100)
    .refine((lines) => new Set(lines.map((line) => line.clientLineId)).size === lines.length, "Duplicate line identifiers")
    .refine((lines) => lines.reduce((total, line) => total + line.quantity, 0) <= 500, "Maximum 500 bags per order"),
});

export const transitionSchema = z.object({
  expectedStatus: z.enum(["QUEUED", "CLAIMED", "GRINDING", "GROUND", "PACKING", "BLOCKED"]),
  nextStatus: z.enum(["CLAIMED", "GRINDING", "GROUND", "PACKING", "COMPLETED", "BLOCKED", "CANCELLED"]),
  grinderUserId: z.uuid().optional(),
  grindId: z.uuid().optional(),
});

export const pendingOrderSchema = z.object({
  body: z.string(),
  lines: z.array(z.object({
    clientLineId: z.string(), quantity: z.number().int().min(1).max(99),
    product: z.object({id:z.uuid(),name:z.string(),sku:z.string(),size_grams:z.number().min(200),unit:z.string(),barcode:z.string()}),
    grind: z.object({id:z.uuid(),barcode:z.string(),grind_value:z.string()}),
  })).min(1).max(100),
}).superRefine((saved,ctx) => {
  try {
    const order = orderSchema.parse(JSON.parse(saved.body));
    const lines = saved.lines.map(line => ({clientLineId:line.clientLineId,productId:line.product.id,productBarcode:line.product.barcode,grindId:line.grind.id,grindBarcode:line.grind.barcode,quantity:line.quantity}));
    if (JSON.stringify(order.lines) !== JSON.stringify(lines)) throw new Error("Draft mismatch");
  } catch { ctx.addIssue({code:"custom",message:"Invalid pending order"}); }
});
