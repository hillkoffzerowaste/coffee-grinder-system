export type AppRole = "counter" | "packer" | "admin";
export type Station = "counter" | "packing";
export type JobStatus = "QUEUED" | "CLAIMED" | "GRINDING" | "GROUND" | "PACKING" | "COMPLETED" | "BLOCKED" | "CANCELLED";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: AppRole;
  station: Station | "both";
  active: boolean;
}

export interface ProductLookup {
  id: string;
  sku: string;
  name: string;
  size_grams: number;
  unit: string;
  barcode: string;
}

export interface GrindLookup {
  id: string;
  grind_value: string;
  barcode: string | null;
}

export interface DraftLine {
  clientLineId: string;
  product: ProductLookup;
  grind: GrindLookup;
  quantity: number;
}

export interface BagJob {
  id: string;
  bag_no: number;
  queue_seq: number;
  status: JobStatus;
  product_name_snapshot: string;
  sku_snapshot: string;
  size_grams_snapshot: number;
  grind_value_snapshot: string;
  product_barcode_snapshot: string;
  grinder_name_snapshot?: string | null;
  created_at: string;
  order?: { order_no: string } | null;
}
