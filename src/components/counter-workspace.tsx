"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/topbar";
import { apiFetch } from "@/lib/api";
import type { DraftLine, GrindLookup, ProductLookup, Profile } from "@/lib/types";

type OrderSummary = { id: string; order_no: string; total_bags: number; status: string; created_at: string };

export function CounterWorkspace({ profile, source = "COUNTER" }: { profile: Profile; source?: "COUNTER" | "PACKING_MANUAL" }) {
  const scanRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState("");
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [grind, setGrind] = useState<GrindLookup | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [grinds, setGrinds] = useState<GrindLookup[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  const loadOrders = useCallback(async () => {
    try { setOrders((await apiFetch<{ orders: OrderSummary[] }>("/api/orders")).orders); }
    catch { /* Existing data stays visible while reconnecting. */ }
  }, []);

  useEffect(() => {
    void apiFetch<{ grinds: GrindLookup[] }>("/api/catalog/options").then((data) => setGrinds(data.grinds)).catch(() => undefined);
    let active = true;
    void apiFetch<{ orders: OrderSummary[] }>("/api/orders").then((data) => {
      if (active) setOrders(data.orders);
    }).catch(() => undefined);
    const timer = setInterval(() => void loadOrders(), 10000);
    return () => { active = false; clearInterval(timer); };
  }, [loadOrders]);

  function resetCurrent() {
    setProduct(null); setGrind(null); setQuantity(1); setScan(""); setEditingId(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const value = scan.trim();
    if (!value || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!product) {
        const result = await apiFetch<{ product: ProductLookup }>(`/api/catalog/product/${encodeURIComponent(value)}`);
        setProduct(result.product); setGrind(null); setQuantity(1);
      } else {
        const result = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(value)}`);
        setGrind(result.grind);
      }
      setScan("");
    } catch (error) { setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
    finally { setBusy(false); setTimeout(() => scanRef.current?.focus(), 0); }
  }

  function addLine() {
    if (!product || !grind || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)) return;
    const line: DraftLine = { clientLineId: editingId || crypto.randomUUID(), product, grind, quantity };
    setLines((current) => editingId ? current.map((item) => item.clientLineId === editingId ? line : item) : [...current, line]);
    requestId.current = null;
    resetCurrent();
  }

  const confirmOrder = useCallback(async () => {
    if (!lines.length || busy || product) return;
    setBusy(true); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await apiFetch<{ order: { order_no: string; total_bags: number } }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ clientRequestId: requestId.current, source, lines: lines.map((line) => ({ clientLineId: line.clientLineId, productId: line.product.id, productBarcode: line.product.barcode, grindId: line.grind.id, grindBarcode: line.grind.barcode, quantity: line.quantity })) }),
      });
      setMessage(`บันทึก ${result.order.order_no} สำเร็จ · ${result.order.total_bags} ถุง`);
      setLines([]); requestId.current = null; void loadOrders();
      scanRef.current?.focus();
    } catch (error) { setError(error instanceof Error ? error.message : "ส่งออเดอร์ไม่สำเร็จ — กดซ้ำเพื่อตรวจสอบด้วยรหัสเดิม"); }
    finally { setBusy(false); }
  }, [lines, busy, product, source, loadOrders]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "F10") { event.preventDefault(); void confirmOrder(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [confirmOrder]);

  return <div className="app-shell">
    <Topbar title={source === "COUNTER" ? "หน้าร้าน" : "เปิดออเดอร์ห้องแพ็ค"} profile={profile} />
    <main id="main" tabIndex={-1} className="workspace grid">
      <section className="panel stack">
        <h2>{!product ? "1. สแกนบาร์โค้ดสินค้า" : !grind ? "2. สแกนบาร์โค้ดเบอร์บด" : "3. เลือกจำนวน"}</h2>
        <form onSubmit={submitScan} className="field">
          <label htmlFor="scan">{product ? "Grind Barcode — สแกนซ้ำเพื่อเปลี่ยนเบอร์ได้" : "Product Barcode"}</label>
          <input ref={scanRef} id="scan" className="input scan-input" autoFocus inputMode="numeric" autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy} placeholder={product ? "สแกนเบอร์บด" : "สแกนเลขบาร์โค้ดสินค้า"} />
        </form>
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        {product && <>
          <div className="product-result"><div><div className="product-name">{product.name}</div><div>{product.sku} · {product.barcode}</div></div><div className="product-size">{product.size_grams} g</div></div>
          <div className="row">
            <label htmlFor="grind-select">เบอร์อื่น:</label>
            <select id="grind-select" className="select" style={{ width: "auto" }} value={grind?.id || ""} onChange={(event) => setGrind(grinds.find((item) => item.id === event.target.value) || null)}><option value="">เลือกเบอร์บด</option>{grinds.map((item) => <option key={item.id} value={item.id}>เบอร์ {item.grind_value}</option>)}</select>
            <button className="button secondary" onClick={resetCurrent}>ยกเลิกรายการนี้</button>
          </div>
          {grind && <div className="row"><strong>เบอร์บด {grind.grind_value}</strong><label htmlFor="quantity">จำนวนถุง</label><input id="quantity" className="input" style={{ width: 90 }} type="number" min={1} max={99} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLine(); } }} /><button className="button" onClick={addLine}>{editingId ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}</button></div>}
        </>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>ขนาด</th><th>เบอร์บด</th><th>ถุง</th><th>จัดการ</th></tr></thead><tbody>{lines.map((line) => <tr key={line.clientLineId}><td>{line.product.name}<br /><small>{line.product.sku}</small></td><td>{line.product.size_grams} g</td><td>{line.grind.grind_value}</td><td>{line.quantity}</td><td><button className="button secondary" disabled={busy} onClick={() => { setProduct(line.product); setGrind(line.grind); setQuantity(line.quantity); setEditingId(line.clientLineId); scanRef.current?.focus(); }}>แก้ไข</button> <button className="button secondary" disabled={busy} onClick={() => { setLines((current) => current.filter((item) => item.clientLineId !== line.clientLineId)); requestId.current = null; }}>ลบ</button></td></tr>)}</tbody></table>{!lines.length && <div className="empty">ยังไม่มีรายการ</div>}</div>
        <div className="sticky-actions"><strong>รวม {total} ถุง</strong><button className="button large" disabled={!lines.length || busy || !!product} onClick={() => void confirmOrder()}>{busy ? "กำลังบันทึก..." : `ยืนยัน ${total} ถุง · F10`}</button></div>
      </section>
      <aside className="panel stack"><h2>ออเดอร์ล่าสุด</h2>{orders.map((order) => <div key={order.id} className="notice"><strong>{order.order_no}</strong><div>{order.total_bags} ถุง · {order.status}</div><small>{new Date(order.created_at).toLocaleString("th-TH")}</small></div>)}{!orders.length && <p className="empty">ยังไม่มีออเดอร์</p>}</aside>
    </main>
  </div>;
}
