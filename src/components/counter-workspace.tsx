"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrderMonitor } from "@/components/order-monitor";
import { dropdownGrinds } from "@/lib/grind-options";
import { Topbar } from "@/components/topbar";
import { GrindBarcodes } from "@/components/grind-barcodes";
import { SoundControls } from "@/components/sound-controls";
import { useSounds } from "@/lib/use-sounds";
import { useCatalog } from "@/lib/use-catalog";
import { apiFetch, ApiError } from "@/lib/api";
import { useScannerFocus, useScannerInput } from "@/lib/scanner";
import { orderSchema, pendingOrderSchema } from "@/lib/validation";
import type { DraftLine, GrindLookup, ProductLookup, Profile } from "@/lib/types";


export function CounterWorkspace({ profile, source = "COUNTER" }: { profile: Profile; source?: "COUNTER" | "PACKING_MANUAL" }) {
  const scanRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [scan, setScan] = useState("");
  useScannerInput(scanRef, setScan);
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [grind, setGrind] = useState<GrindLookup | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const {grinds,catalogError,reloadCatalog}=useCatalog();
  const sound=useSounds();
  const {play}=sound;
  const [monitorRevision,setMonitorRevision]=useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const operation = useRef(false);
  const retryBody = useRef<string | null>(null);
  const [awaitingRetry, setAwaitingRetry] = useState(false);
  useScannerFocus(scanRef, busy || awaitingRetry);
  const storageKey = `coffee-pending:${profile.id}:${source}`;
  const ready = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const pending = pendingOrderSchema.parse(JSON.parse(saved));
          const parsed = orderSchema.parse(JSON.parse(pending.body));
          if (parsed.source !== source) throw new Error("Wrong station draft");
          retryBody.current = pending.body; requestId.current = parsed.clientRequestId;
          setLines(pending.lines);
          setAwaitingRetry(true);
          setError("พบออเดอร์รอยืนยันผล กรุณากดยืนยันอีกครั้งเพื่อรับผลบันทึกเดิม");
        }
      } catch { setError("อ่านออเดอร์ที่ค้างไว้ไม่ได้ กรุณาตรวจออเดอร์ล่าสุดก่อนเปิดรายการใหม่"); }
      ready.current = true;
    });
    return () => { active = false; };
  }, [storageKey, source]);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  function resetCurrent() {
    setProduct(null); setGrind(null); setQuantity(1); setScan(""); setEditingId(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const value = (scanRef.current?.value ?? scan).trim();
    if (!value || !ready.current || operation.current || awaitingRetry) return;
    operation.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!product) {
        const result = await apiFetch<{ product: ProductLookup }>(`/api/catalog/product/${encodeURIComponent(value)}`);
        setProduct(result.product); setGrind(null); setQuantity(1);
      } else {
        const result = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(value)}`);
        setGrind(result.grind);
      }
      setScan(""); play("success");
    } catch (error) { if(product)setGrind(null); play("error"); setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); setTimeout(() => scanRef.current?.focus(), 0); }
  }

  function addLine() {
    if (operation.current || awaitingRetry || !product || !grind || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)) return;
    const remaining = lines.filter(line => line.clientLineId !== editingId);
    if (remaining.length >= 100 || remaining.reduce((sum, line) => sum + line.quantity, quantity) > 500) {
      setError("หนึ่งออเดอร์รองรับไม่เกิน 100 รายการ และ 500 ถุง"); return;
    }
    const line: DraftLine = { clientLineId: editingId || crypto.randomUUID(), product, grind, quantity };
    setLines((current) => editingId ? current.map((item) => item.clientLineId === editingId ? line : item) : [...current, line]);
    requestId.current = null;
    resetCurrent();
  }

  const confirmOrder = useCallback(async () => {
    if (!lines.length || operation.current || product) return;
    operation.current = true;
    setBusy(true); setError("");
    requestId.current ||= crypto.randomUUID();
    retryBody.current ||= JSON.stringify({ clientRequestId: requestId.current, source, lines: lines.map((line) => ({ clientLineId: line.clientLineId, productId: line.product.id, productBarcode: line.product.barcode, grindId: line.grind.id, grindBarcode: line.grind.barcode, quantity: line.quantity })) });
    try {
      // Persist before the request so a reload cannot generate a duplicate order.
      sessionStorage.setItem(storageKey, JSON.stringify({body:retryBody.current,lines}));
      const result = await apiFetch<{ order: { order_no: string; total_bags: number } }>("/api/orders", {
        method: "POST",
        body: retryBody.current,
      });
      play("success");
      setMessage(`บันทึก ${result.order.order_no} สำเร็จ · ${result.order.total_bags} ถุง`);
      setLines([]); requestId.current = null; retryBody.current = null; setAwaitingRetry(false); setMonitorRevision(value=>value+1);
      sessionStorage.removeItem(storageKey);
      scanRef.current?.focus();
    } catch (error) {
      play("error");
      const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (rejected) { requestId.current = null; retryBody.current = null; sessionStorage.removeItem(storageKey); }
      setAwaitingRetry(!rejected);
      setError(rejected ? error.message : "ยังยืนยันผลบันทึกไม่ได้ กรุณากดยืนยันซ้ำด้วยรายการเดิมก่อนแก้ไขออเดอร์");
    }
    finally { operation.current = false; setBusy(false); }
  }, [lines, product, source, storageKey, play]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "F10") { event.preventDefault(); void confirmOrder(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [confirmOrder]);

  return <div className="app-shell operational-shell">
    <Topbar title={source === "COUNTER" ? "หน้าร้าน" : "เปิดออเดอร์ห้องแพ็ค"} profile={profile} />
    <main id="main" tabIndex={-1} className="workspace grid counter-layout">
      <section className="panel counter-composer"><div ref={composerRef} className="composer-content stack">
        <div className="composer-heading"><SoundControls sound={sound} onReady={()=>scanRef.current?.focus({preventScroll:true})} />
        <h2>{!product ? "1. สแกนบาร์โค้ดสินค้า" : !grind ? "2. สแกนบาร์โค้ดเบอร์บด" : "3. เลือกจำนวน"}</h2>
        </div>
        <form onSubmit={submitScan} className="field">
          <label htmlFor="scan">{product ? "Grind Barcode — สแกนซ้ำเพื่อเปลี่ยนเบอร์ได้" : "Product Barcode"}</label>
          <input ref={scanRef} id="scan" className="input scan-input" autoFocus inputMode="numeric" autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy || awaitingRetry} placeholder={product ? "สแกนเบอร์บด" : "สแกนเลขบาร์โค้ดสินค้า"} />
        </form>
        <section className="barcode-drawer"><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} /></section>
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        {product && <>
          <div className="product-result"><div><div className="product-name">{product.name}</div><div>{product.sku} · {product.barcode}</div></div><div className="product-size">{product.size_grams} g</div></div>
          <div className="row">
            <label htmlFor="grind-select">เบอร์อื่น:</label>
            <select id="grind-select" disabled={busy || awaitingRetry} className="select" style={{ width: "auto" }} value={grind?.id || ""} onChange={(event) => { const chosen=grinds.find(item=>item.id===event.target.value);setGrind(chosen?{...chosen,barcode:null}:null); }}><option value="">เลือกเบอร์บด</option>{dropdownGrinds(grinds).map((item) => <option key={item.id} value={item.id}>เบอร์ {item.grind_value}</option>)}</select>
            <button className="button secondary" disabled={busy} onClick={resetCurrent}>ยกเลิกรายการนี้</button>
          </div>
          {grind && <div className="row"><strong>เบอร์บด {grind.grind_value}</strong><label htmlFor="quantity">จำนวนถุง</label><input disabled={busy || awaitingRetry} id="quantity" className="input" style={{ width: 90 }} type="number" min={1} max={99} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLine(); } }} /><button className="button" disabled={busy || awaitingRetry} onClick={addLine}>{editingId ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}</button></div>}
        </>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>ขนาด</th><th>เบอร์บด</th><th>ถุง</th><th>จัดการ</th></tr></thead><tbody>{lines.map((line) => <tr key={line.clientLineId}><td>{line.product.name}<br /><small>{line.product.sku}</small></td><td>{line.product.size_grams} g</td><td>{line.grind.grind_value}</td><td>{line.quantity}</td><td><button className="button secondary" disabled={busy || awaitingRetry} onClick={() => { if (operation.current || awaitingRetry) return; setProduct(line.product); setGrind(line.grind); setQuantity(line.quantity); setEditingId(line.clientLineId); scanRef.current?.focus(); }}>แก้ไข</button> <button className="button secondary" disabled={busy || awaitingRetry} onClick={() => { if (operation.current || awaitingRetry) return; setLines((current) => current.filter((item) => item.clientLineId !== line.clientLineId)); requestId.current = null; }}>ลบ</button></td></tr>)}</tbody></table>{!lines.length && <div className="empty">ยังไม่มีรายการ</div>}</div>
        </div><div className="sticky-actions"><strong>รวม {total} ถุง</strong><button type="button" className="button secondary" onClick={()=>composerRef.current?.querySelector(product?".product-result":".data-table-wrap")?.scrollIntoView({block:"start"})}>ดู{product?"รายละเอียด":"รายการ"} ↓</button><button className="button large" disabled={!lines.length || busy || !!product} onClick={() => void confirmOrder()}>{busy ? "กำลังบันทึก..." : `ยืนยัน ${total} ถุง · F10`}</button></div>
      </section>
      <OrderMonitor revision={monitorRevision} />
    </main>
  </div>;
}
