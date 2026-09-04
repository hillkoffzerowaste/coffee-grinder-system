export const adminEntities = {
  products: ["sku", "name", "size_grams", "unit", "product_type", "active"],
  product_barcodes: ["product_id", "barcode", "barcode_type", "active"],
  grind_size_codes: ["grind_value", "barcode", "active", "sort_order"],
  grinder_users: ["name", "active", "sort_order"],
  app_settings: ["key", "value", "description"],
} as const;

export type AdminEntity = keyof typeof adminEntities;

export function isAdminEntity(value: string): value is AdminEntity {
  return value in adminEntities;
}

export function pickAllowed(entity: AdminEntity, payload: Record<string, unknown>) {
  return Object.fromEntries(adminEntities[entity].filter((key) => key in payload).map((key) => [key, payload[key]]));
}
