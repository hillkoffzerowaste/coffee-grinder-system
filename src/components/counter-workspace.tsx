"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QuantityDialog } from "@/components/quantity-dialog";
import { OrderMonitor } from "@/components/order-monitor";
import { dropdownGrinds } from "@/lib/grind-options";
import { Topbar } from "@/components/topbar";
import { GrindBarcodes } from "@/components/grind-barcodes";
import { SoundControls } from "@/components/sound-controls";
import { useSounds } from "@/lib/use-sounds";
import { useCatalog } from "@/lib/use-catalog";
import { apiFetch, ApiError } from "@/lib/api";
import { useScannerFocus, useScannerInput } from "@/lib/scanner";
import { batchCompleteSchema, orderSchema, pendingOrderSchema } from "@/lib/validation";
import type { DraftLine, GrindLookup, ProductLookup, Profile } from "@/lib/types";


export function CounterWorkspace({ profile, source = "COUNTER" }: { profile: Profile; source?: "COUNTER" | "PACKING_MANUAL" }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [scan, setScan] = useState("");
  useScannerInput(scanRef, setScan);
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [grind, setGrind] = useState<GrindLookup | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const quantityActive = useRef(false);
  const [quantityError, setQuantityError] = useState("");
  const [grinderUserId, setGrinderUserId] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const {grinds,grinders,catalogError,reloadCatalog}=useCatalog();
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
  useScannerFocus(scanRef, busy || awaitingRetry || quantityOpen || recoveryRequired);
  const storageKey = `coffee-pending:${profile.id}:${source}`;
  const ready = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          // Old manual requests must be verified, never upgraded and replayed.
          const stored = JSON.parse(saved);
          const storedBody = JSON.parse(stored.body);
          if (source === "PACKING_MANUAL" && !storedBody.grinderUserId) {
            throw new Error("Legacy manual order requires recovery");
          }
          const pending = pendingOrderSchema.parse(JSON.parse(saved));
          const parsed = orderSchema.parse(JSON.parse(pending.body));
          if (parsed.source !== source) throw new Error("Wrong station draft");
          retryBody.current = pending.body; requestId.current = parsed.clientRequestId;
          setGrinderUserId(typeof storedBody.grinderUserId === "string" ? storedBody.grinderUserId : "");
          setLines(pending.lines);
          setAwaitingRetry(true);
          setError("พบออเดอร์รอยืนยันผล กรุณากดยืนยันอีกครั้งเพื่อรับผลบันทึกเดิม");
        }
      } catch {
        setRecoveryRequired(true);
        setError("ออเดอร์ค้างต้องตรวจสอบผลบันทึกเดิมก่อน โดยเฉพาะรายการห้องแพ็คที่ไม่มีผู้บด กรุณาตรวจออเดอร์ล่าสุดก่อนเปิดรายการใหม่");
      }
      ready.current = true;
    });
    return () => { active = false; };
  }, [storageKey, source]);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  function resetCurrent() {
    quantityActive.current = false;
    setQuantityOpen(false); setQuantityError("");
    setProduct(null); setGrind(null); setQuantity(1); setScan(""); setEditingId(null);
    if (scanRef.current) scanRef.current.value = "";
    setTimeout(() => scanRef.current?.focus({ preventScroll: true }), 0);
  }

  function openQuantity(selectedGrind: GrindLookup, initial = 1) {
    setGrind(selectedGrind); setQuantity(initial); setQuantityError("");
    quantityActive.current = true;
    setQuantityOpen(true);
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const value = (scanRef.current?.value ?? scan).trim();
    if (!value || !ready.current || operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return;
    operation.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!product) {
        const result = await apiFetch<{ product: ProductLookup }>(`/api/catalog/product/${encodeURIComponent(value)}`);
        setProduct(result.product); setGrind(null); setQuantity(1);
        composerRef.current?.scrollTo({ top: 0 });
        composerRef.current?.firstElementChild?.scrollIntoView({ block: "start" });
      } else {
        const result = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(value)}`);
        openQuantity(result.grind);
      }
      setScan(""); if (scanRef.current) scanRef.current.value = ""; play("success");
    } catch (error) { if(product)setGrind(null); play("error"); setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); setTimeout(() => { if (!quantityActive.current) scanRef.current?.focus({ preventScroll: true }); }, 0); }
  }

  function addLine(quantity: number) {
    if (!quantityActive.current || operation.current || awaitingRetry || recoveryRequired || !product || !grind || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)) return;
    const remaining = lines.filter(line => line.clientLineId !== editingId);
    if (remaining.length >= 100 || remaining.reduce((sum, line) => sum + line.quantity, quantity) > 500) {
      setQuantityError("หนึ่งออเดอร์รองรับไม่เกิน 100 รายการ และ 500 ถุง"); return;
    }
    const line: DraftLine = { clientLineId: editingId || crypto.randomUUID(), product, grind, quantity };
    setLines((current) => editingId ? current.map((item) => item.clientLineId === editingId ? line : item) : [...current, line]);
    requestId.current = null;
    resetCurrent();
  }

  const confirmOrder = useCallback(async () => {
    if (!ready.current || !lines.length || operation.current || product || quantityActive.current || recoveryRequired || document.querySelector("dialog[open]")) return;
    if (source === "PACKING_MANUAL" && !grinderUserId) {
      setError("กรุณาเลือกผู้บดก่อนยืนยันออเดอร์"); return;
    }
    operation.current = true;
    setBusy(true); setError("");
    requestId.current ||= crypto.randomUUID();
    retryBody.current ||= JSON.stringify({ clientRequestId: requestId.current, source, ...(source === "PACKING_MANUAL" ? { grinderUserId } : {}), lines: lines.map((line) => ({ clientLineId: line.clientLineId, productId: line.product.id, productBarcode: line.product.barcode, grindId: line.grind.id, grindBarcode: line.grind.barcode, quantity: line.quantity })) });
    try {
      // Persist before the request so a reload cannot generate a duplicate order.
      sessionStorage.setItem(storageKey, JSON.stringify({body:retryBody.current,lines}));
      const result = await apiFetch<{ order: { id: string; order_no: string; total_bags: number; batch_id: string | null } }>("/api/orders", {
        method: "POST",
        body: retryBody.current,
      });
      if (!result.order || typeof result.order.order_no !== "string" || !Number.isInteger(result.order.total_bags) || (source === "PACKING_MANUAL" && !batchCompleteSchema.safeParse({clientRequestId:requestId.current,batchId:result.order.batch_id}).success)) throw new ApiError("ผลบันทึกไม่สมบูรณ์ กรุณายืนยันซ้ำด้วยรายการเดิม",502);
      sessionStorage.removeItem(storageKey);
      play("success");
      setMessage(`บันทึก ${result.order.order_no} สำเร็จ · ${result.order.total_bags} ถุง`);
      setLines([]); requestId.current = null; retryBody.current = null; setAwaitingRetry(false); setMonitorRevision(value=>value+1);
      if (source === "PACKING_MANUAL" && result.order.batch_id) {
        router.push('/packing?batch=' + encodeURIComponent(result.order.batch_id));
      }
      scanRef.current?.focus();
    } catch (error) {
      play("error");
      const rejected = error instanceof ApiError && [400,409,422].includes(error.status);
      if (rejected) { requestId.current = null; retryBody.current = null; sessionStorage.removeItem(storageKey); }
      setAwaitingRetry(!rejected);
      setError(rejected ? error.message : "ยังยืนยันผลบันทึกไม่ได้ กรุณากดยืนยันซ้ำด้วยรายการเดิมก่อนแก้ไขออเดอร์");
    }
    finally { operation.current = false; setBusy(false); }
  }, [lines, product, source, storageKey, play, grinderUserId, recoveryRequired, router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "F10") { event.preventDefault(); if (!event.repeat && !quantityActive.current && !document.querySelector("dialog[open]")) void confirmOrder(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [confirmOrder]);

  return <div className="app-shell operational-shell">
    <Topbar title={source === "COUNTER" ? "หน้าร้าน" : "เปิดออเดอร์ห้องแพ็ค"} profile={profile} />
    <main id="main" tabIndex={-1} className="workspace grid counter-layout">
      <section className="panel counter-composer"><div ref={composerRef} className="composer-content stack">
        <div className="composer-heading"><SoundControls sound={sound} onReady={()=>scanRef.current?.focus({preventScroll:true})} />
        <h2>{!product ? "1. สแกนบาร์โค้ดสินค้า" : !grind ? "2. สแกนบาร์โค้ดเบอร์บด" : "3. เลือกจำนวน"}</h2>
        </div>
        {product && <div className="product-result" role="status"><div><div className="product-name">{product.name}</div><div>{product.sku} · {product.barcode}</div></div><div className="product-size">{product.size_grams} g</div></div>}
        <form onSubmit={submitScan} className="field">
          <label htmlFor="scan">{product ? "Grind Barcode — สแกนซ้ำเพื่อเปลี่ยนเบอร์ได้" : "Product Barcode"}</label>
          <input ref={scanRef} id="scan" className="input scan-input" autoFocus inputMode="numeric" autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} placeholder={product ? "สแกนเบอร์บด" : "สแกนเลขบาร์โค้ดสินค้า"} />
        </form>
        <section className="barcode-drawer"><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} /></section>
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        {product && <>
          <div className="row">
            <label htmlFor="grind-select">เบอร์อื่น:</label>
            <select id="grind-select" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} className="select" style={{ width: "auto" }} value={grind?.id || ""} onChange={(event) => { const chosen=grinds.find(item=>item.id===event.target.value); if (chosen) openQuantity({...chosen,barcode:null}); else setGrind(null); }}><option value="">เลือกเบอร์บด</option>{dropdownGrinds(grinds).map((item) => <option key={item.id} value={item.id}>เบอร์ {item.grind_value}</option>)}</select>
            <button className="button secondary" disabled={busy} onClick={resetCurrent}>ยกเลิกรายการนี้</button>
          </div>
        </>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>ขนาด</th><th>เบอร์บด</th><th>ถุง</th><th>จัดการ</th></tr></thead><tbody>{lines.map((line) => <tr key={line.clientLineId}><td>{line.product.name}<br /><small>{line.product.sku}</small></td><td>{line.product.size_grams} g</td><td>{line.grind.grind_value}</td><td>{line.quantity}</td><td><button className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return; setProduct(line.product); setEditingId(line.clientLineId); openQuantity(line.grind, line.quantity); }}>แก้ไข</button> <button className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return; setLines((current) => current.filter((item) => item.clientLineId !== line.clientLineId)); requestId.current = null; }}>ลบ</button></td></tr>)}</tbody></table>{!lines.length && <div className="empty">ยังไม่มีรายการ</div>}</div>
        {source === "PACKING_MANUAL" && <div className="field"><label htmlFor="grinder-select">ผู้บด</label><select id="grinder-select" className="select" required value={grinderUserId} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onChange={(event) => setGrinderUserId(event.target.value)}><option value="">เลือกผู้บดก่อนยืนยัน</option>{grinderUserId && !grinders.some(item => item.id === grinderUserId) && <option value={grinderUserId}>ผู้บดที่บันทึกไว้ ({grinderUserId})</option>}{grinders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
        </div><div className="sticky-actions"><strong>รวม {total} ถุง</strong><button type="button" className="button secondary" onClick={()=>composerRef.current?.querySelector(product?".product-result":".data-table-wrap")?.scrollIntoView({block:"start"})}>ดู{product?"รายละเอียด":"รายการ"} ↓</button><button type="button" className="button large" disabled={!lines.length || busy || !!product || quantityOpen || recoveryRequired || (source === "PACKING_MANUAL" && !grinderUserId)} onClick={() => void confirmOrder()}>{busy ? "กำลังบันทึก..." : `ยืนยัน ${total} ถุง · F10`}</button></div>
      </section>
      <OrderMonitor revision={monitorRevision} />
    </main>
    {quantityOpen && product && grind && <QuantityDialog title={editingId ? "แก้ไขจำนวนถุง" : "เลือกจำนวนถุง"} description={`${product.name} · เบอร์บด ${grind.grind_value}`} max={Math.min(99, Math.max(1, 500 - lines.filter(line => line.clientLineId !== editingId).reduce((sum, line) => sum + line.quantity, 0)))} initial={quantity} busy={busy} error={quantityError} onConfirm={addLine} onCancel={resetCurrent}><p>{product.sku} · {product.size_grams} g</p></QuantityDialog>}
  </div>;
}
