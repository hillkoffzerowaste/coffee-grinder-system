"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/topbar";
import { AdminPasswordReset } from "@/components/admin-password-reset";
import { apiFetch } from "@/lib/api";
import type { Profile } from "@/lib/types";

type Entity = "products" | "product_barcodes" | "grind_size_codes" | "grinder_users" | "users" | "app_settings";
type Row = Record<string, unknown>;
const config: Record<Entity, { title: string; fields: string[] }> = {
  products: { title: "สินค้า / SKU", fields: ["sku", "name", "size_grams", "unit", "product_type", "active"] },
  product_barcodes: { title: "บาร์โค้ดสินค้า", fields: ["product_id", "barcode", "barcode_type", "active"] },
  grind_size_codes: { title: "เบอร์บด / Barcode", fields: ["grind_value", "barcode", "sort_order", "active"] },
  grinder_users: { title: "รายชื่อคนบด", fields: ["name", "sort_order", "active"] },
  users: { title: "ผู้ใช้และสิทธิ์", fields: ["username", "displayName", "password", "role", "station"] },
  app_settings: { title: "ตั้งค่าระบบ", fields: ["key", "value", "description"] },
};
const labels: Record<string, string> = { sku: "SKU", name: "ชื่อ", size_grams: "ขนาด (กรัม)", unit: "หน่วย", product_type: "ประเภท", active: "เปิดใช้งาน", product_id: "Product ID", barcode: "Barcode", barcode_type: "ประเภท Barcode", grind_value: "เบอร์บด", sort_order: "ลำดับ", username: "Username", displayName: "ชื่อแสดงผล", password: "Password", role: "สิทธิ์", station: "สถานี", key: "Key", value: "ค่า (JSON)", description: "คำอธิบาย" };

export function AdminConsole({ profile }: { profile: Profile }) {
  const [entity, setEntity] = useState<Entity>("products");
  const [items, setItems] = useState<Row[]>([]);
  const [form, setForm] = useState<Row>({ active: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const operation = useRef(false);
  const entityRef = useRef<Entity>("products");
  const load = useCallback(async () => {
    setError("");
    try {
      const result = await apiFetch<{ items: Row[] }>(`/api/admin/${entity}`);
      if (entityRef.current === entity) setItems(result.items);
    }
    catch (error) { if (entityRef.current === entity) setError(error instanceof Error ? error.message : "โหลดไม่สำเร็จ"); }
  }, [entity]);
  useEffect(() => {
    let active = true;
    apiFetch<{ items: Row[] }>(`/api/admin/${entity}`).then((data) => {
      if (active) { setItems(data.items); setError(""); }
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : "โหลดไม่สำเร็จ");
    });
    return () => { active = false; };
  }, [entity]);
  function selectEntity(value: Entity) {
    if (operation.current || value === entityRef.current) return;
    entityRef.current = value; setEntity(value); setItems([]); setError(""); setForm({ active: true }); setEditingId(null); setSearch(""); setMessage("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const payload = { ...form };
      if(entity==="grind_size_codes" && !payload.barcode)payload.barcode=null;
      for (const field of ["size_grams", "sort_order"]) if (field in payload) payload[field] = Number(payload[field]);
      if (entity === "app_settings" && typeof payload.value === "string") payload.value = JSON.parse(payload.value);
      await apiFetch(`/api/admin/${entity}${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setMessage("บันทึกสำเร็จ"); setForm({ active: true }); setEditingId(null); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); }
  }
  async function deactivate(id: string) {
    if (operation.current) return;
    if (!confirm("ปิดใช้งานรายการนี้? ประวัติเก่าจะยังคงอยู่")) return;
    operation.current = true; setBusy(true);
    try { await apiFetch(`/api/admin/${entity}/${id}`, { method: "DELETE" }); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "ปิดใช้งานไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); }
  }
  const visible = items.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()));
  return <div className="app-shell"><Topbar title="Admin Console" profile={profile} /><main id="main" tabIndex={-1} className="admin-layout">
    <nav className="admin-nav" aria-label="เมนูจัดการ">{Object.entries(config).map(([key, value]) => <button key={key} className={`tab ${entity === key ? "active" : ""}`} onClick={() => selectEntity(key as Entity)}>{value.title}</button>)}</nav>
    <div className="admin-main stack"><h2>{config[entity].title}</h2>{error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
      <form className="panel stack" onSubmit={save}><h3>{editingId ? "แก้ไขรายการ" : "เพิ่มรายการ"}</h3><div className="row">{config[entity].fields.map((field) => <div key={field} className="field" style={{ flex: "1 1 180px" }}><label htmlFor={`admin-${field}`}>{labels[field] || field}</label>{field === "active" ? <select id={`admin-${field}`} className="select" value={String(form[field] ?? true)} onChange={(event) => setForm({ ...form, [field]: event.target.value === "true" })}><option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งาน</option></select> : ["role", "station"].includes(field) ? <select id={`admin-${field}`} className="select" value={String(form[field] || "")} required onChange={(event) => setForm({ ...form, [field]: event.target.value })}><option value="">เลือก</option>{(field === "role" ? ["counter", "packer", "admin"] : ["counter", "packing", "both"]).map((value) => <option key={value}>{value}</option>)}</select> : <input id={`admin-${field}`} className="input" type={field === "password" ? "password" : ["size_grams", "sort_order"].includes(field) ? "number" : "text"} autoComplete={field === "password" ? "new-password" : "off"} value={typeof form[field] === "object" ? JSON.stringify(form[field]) : String(form[field] ?? "")} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required={!(entity==="grind_size_codes"&&field==="barcode")&&!["description", "sort_order"].includes(field)} />}</div>)}</div><div className="row"><button className="button" disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</button><button type="button" className="button secondary" onClick={() => { setForm({ active: true }); setEditingId(null); }}>ล้างฟอร์ม</button></div></form>
      <section className="panel stack"><input className="input" aria-label="ค้นหา" placeholder="ค้นหา SKU / ชื่อ / Barcode" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="data-table-wrap"><table className="data-table"><thead><tr>{(entity === "users" ? ["username", "display_name", "role", "station", "active"] : config[entity].fields).map((field) => <th key={field}>{labels[field] || field}</th>)}<th>จัดการ</th></tr></thead><tbody>{visible.map((item) => <tr key={String(item.id)}>{(entity === "users" ? ["username", "display_name", "role", "station", "active"] : config[entity].fields).map((field) => <td key={field}>{typeof item[field] === "object" ? JSON.stringify(item[field]) : String(item[field] ?? "")}</td>)}<td>{entity !== "users" && <><button className="button secondary" onClick={() => { setEditingId(String(item.id)); setForm(item); }}>แก้ไข</button>{entity !== "app_settings" && <button className="button secondary" onClick={() => void deactivate(String(item.id))}>ปิดใช้งาน</button>}</>}</td></tr>)}</tbody></table></div><small>{visible.length} รายการ</small></section>
      {entity === "users" && <AdminPasswordReset users={items.map(item => ({ id: String(item.id), username: String(item.username) }))} />}
    </div>
  </main></div>;
}
