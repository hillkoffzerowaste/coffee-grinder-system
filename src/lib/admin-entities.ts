import { z } from "zod";

export const adminEntities = {
  products: ["sku", "name", "size_grams", "unit", "product_type", "active"],
  product_barcodes: ["product_id", "barcode", "barcode_type", "active"],
  grind_size_codes: ["grind_value", "barcode", "active", "sort_order"],
  grinder_users: ["name", "active", "sort_order"],
  app_settings: ["key", "value", "description"],
} as const;

export type AdminEntity = keyof typeof adminEntities;

export function isAdminEntity(value: string): value is AdminEntity {
  return Object.hasOwn(adminEntities, value);
}

export function pickAllowed(entity: AdminEntity, payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  return Object.fromEntries(adminEntities[entity].filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
}

const name = z.string().trim().min(1).max(300);
const schemas = {
  products: z.object({ sku: name, name, size_grams: z.number().int().min(200), unit: name.optional(), product_type: z.literal("BEANS").optional(), active: z.boolean().optional() }),
  product_barcodes: z.object({ product_id: z.uuid(), barcode: z.string().regex(/^\d{4,32}$/), barcode_type: z.literal("PRODUCT").optional(), active: z.boolean().optional() }),
  grind_size_codes: z.object({ grind_value: name, barcode: z.string().regex(/^\d{1,32}$/).nullable(), sort_order: z.number().int().optional(), active: z.boolean().optional() }),
  grinder_users: z.object({ name, sort_order: z.number().int().optional(), active: z.boolean().optional() }),
  app_settings: z.object({ key: name, value: z.json(), description: z.string().max(1000).nullable().optional() }),
};
export function parseAdminPayload(entity: AdminEntity, value: unknown, partial = false) {
  const schema = partial ? schemas[entity].partial() : schemas[entity];
  return schema.refine(v => Object.keys(v).length > 0, "No fields supplied").safeParse(pickAllowed(entity, value));
}
