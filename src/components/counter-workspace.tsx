"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QuantityDialog } from "@/components/quantity-dialog";
import { ProductSearch } from "@/components/product-search";
import { SizeTag } from "@/components/size-tag";
import { BlendBadge } from "@/components/blend-badge";
import { OrderMonitor } from "@/components/order-monitor";
import { dropdownGrinds } from "@/lib/grind-options";
import { Topbar } from "@/components/topbar";
import { GrindBarcodes } from "@/components/grind-barcodes";
import { SoundControls } from "@/components/sound-controls";
import { useSounds } from "@/lib/use-sounds";
import { useCatalog } from "@/lib/use-catalog";
import { canJoinBlendGroup, mergeBlendLine, blendLineSummary, productLine, isGround250, type BlendDraftLine, type BlendGroupDraft, type BlendMode } from "@/lib/blend-orders";
import { apiFetch, ApiError } from "@/lib/api";
import { useScannerFocus, useScannerInput } from "@/lib/scanner";
import { batchCompleteSchema, orderSchema, pendingOrderSchema } from "@/lib/validation";
import type { GrindLookup, ProductLookup, Profile } from "@/lib/types";
import type { UiConfig } from "@/lib/ui-config";


export function CounterWorkspace({ profile, source = "COUNTER", embedded, onCompleted, onCancel, uiConfig }: { profile: Profile; source?: "COUNTER" | "PACKING_MANUAL"; embedded?: boolean; onCompleted?: (batchId: string) => void; onCancel?: () => void; uiConfig?: UiConfig }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [scan, setScan] = useState("");
  useScannerInput(scanRef, setScan);
  const [product, setProduct] = useState<ProductLookup | null>(null);
  const [grind, setGrind] = useState<GrindLookup | null>(null);
  const [mode, setMode] = useState<BlendMode>("GROUND");
  const [quantity, setQuantity] = useState(1);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const quantityActive = useRef(false);
  const [quantityError, setQuantityError] = useState("");
  const [grinderUserId, setGrinderUserId] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [lines, setLines] = useState<BlendDraftLine[]>([]);
  const [activeGroup, setActiveGroup] = useState<BlendGroupDraft | null>(null);
  const [orderMode, setOrderMode] = useState<"SINGLE" | "BLEND">("SINGLE");
  const [note, setNote] = useState("");
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
          setNote(typeof storedBody.note === "string" ? storedBody.note : "");
          setLines(pending.lines.map((line) => ({...line, blendGroupId: line.blendGroupId ?? line.clientLineId, mode: line.mode ?? "GROUND"})));
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

  function openQuantity(selectedGrind: GrindLookup | null, initial = 1) {
    if (!ready.current || operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return;
    setGrind(selectedGrind); setQuantity(initial); setQuantityError("");
    quantityActive.current = true;
    setQuantityOpen(true);
  }

  function beginNewGroup() {
    if (busy || awaitingRetry || recoveryRequired || quantityActive.current) return;
    resetCurrent(); setActiveGroup(null); setMode("GROUND"); setMessage("เริ่มชุดใหม่แล้ว — สแกน SKU รายการแรก");
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const value = (scanRef.current?.value ?? scan).trim();
    if (!value || !ready.current || operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return;
    if (!product && /\D/.test(value)) return;
    operation.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!product) {
        const result = await apiFetch<{ product: ProductLookup }>(`/api/catalog/product/${encodeURIComponent(value)}`);
        setProduct(result.product); setGrind(carriedGroup()?.grind ?? null); setMode(carriedGroup()?.mode ?? "GROUND"); setQuantity(1);
        composerRef.current?.scrollTo({ top: 0 });
        composerRef.current?.firstElementChild?.scrollIntoView({ block: "start" });
        const carried = carriedGrind();
        if (carried) { setGrind(carried); setQuantityError(""); quantityActive.current = true; setQuantityOpen(true); }
      } else {
        if (mode === "WHOLE_BEAN") throw new Error("ชุดนี้เป็นเมล็ด ไม่ต้องสแกนเบอร์บด");
        const result = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(value)}`);
        setGrind(result.grind); setQuantity(1); setQuantityError("");
        quantityActive.current = true; setQuantityOpen(true);
      }
      setScan(""); if (scanRef.current) scanRef.current.value = ""; play("success");
    } catch (error) { if(product)setGrind(null); play("error"); setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); setTimeout(() => { if (!quantityActive.current) scanRef.current?.focus({ preventScroll: true }); }, 0); }
  }

  // ชุดผสมบังคับเบอร์บดเดียวทั้งชุดอยู่แล้ว การให้สแกนเบอร์ซ้ำทุก SKU จึงเป็นงานเปล่า
  const carriedGroup = () => orderMode === "BLEND" ? activeGroup : null;
  const carriedGrind = () => carriedGroup()?.mode === "GROUND" ? carriedGroup()?.grind ?? null : null;

  function selectProduct(selected: ProductLookup) {
    if (!ready.current || operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return;
    setProduct(selected); setGrind(carriedGroup()?.grind ?? null); setMode(carriedGroup()?.mode ?? "GROUND"); setQuantity(1); setEditingId(null); setScan(""); setError(""); setMessage("");
    if (scanRef.current) scanRef.current.value = "";
    const carried = carriedGrind();
    if (carried) { openQuantity(carried); return; }
    composerRef.current?.scrollTo({ top: 0 });
    composerRef.current?.firstElementChild?.scrollIntoView({ block: "start" });
    scanRef.current?.focus({ preventScroll: true });
  }

  function cancelWorkspace() {
    if (!ready.current || operation.current || retryBody.current || awaitingRetry || quantityActive.current || recoveryRequired) return;
    if ((lines.length || product || scan.trim()) && !window.confirm("มีรายการที่ยังไม่ได้บันทึก ต้องการยกเลิกและกลับห้องแพ็คหรือไม่?")) return;
    onCancel?.();
  }

  const groupsFor = (items: BlendDraftLine[]) => blendLineSummary(items);

  function addLine(quantity: number, completeOrder = false) {
    if (!quantityActive.current || operation.current || awaitingRetry || recoveryRequired || !product || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)) return;
    if (source === "PACKING_MANUAL" && !grinderUserId) { setQuantityError("กรุณาเลือกผู้บดก่อนยืนยัน"); return; }
    const remaining = lines.filter(line => line.clientLineId !== editingId);
    if (remaining.length >= 100 || remaining.reduce((sum, line) => sum + line.quantity, quantity) > 500) {
      setQuantityError("หนึ่งออเดอร์รองรับไม่เกิน 100 รายการ และ 500 ถุง"); return;
    }
    const carryGroup = editingId || orderMode === "BLEND" ? activeGroup : null;
    let group = carryGroup ?? { id: crypto.randomUUID(), mode, grind: mode === "GROUND" ? grind : null };
    if (!canJoinBlendGroup(group, mode, mode === "GROUND" ? grind : null)) {
      group = { id: crypto.randomUUID(), mode, grind: mode === "GROUND" ? grind : null };
      setMessage("เบอร์บด/สถานะต่างกัน ระบบสร้างชุดใหม่ให้แล้ว");
    }
    const line = productLine(product, group.id, mode, mode === "GROUND" ? grind : null, quantity, editingId || crypto.randomUUID());
    const nextLines = editingId ? lines.map((item) => item.clientLineId === editingId ? line : item) : mergeBlendLine(lines, line);
    if (orderMode === "BLEND") setActiveGroup(group);
    else setActiveGroup(null);
    setLines(nextLines);
    requestId.current = null;
    resetCurrent();
    if (completeOrder) void executeOrder(nextLines);
  }

  const executeOrder = useCallback(async (snapshot: BlendDraftLine[]) => {
    if (!ready.current || !snapshot.length || operation.current || recoveryRequired) return;
    if (source === "PACKING_MANUAL" && !grinderUserId) {
      setError("กรุณาเลือกผู้บดก่อนยืนยันออเดอร์"); return;
    }
    operation.current = true;
    setBusy(true); setError("");
    requestId.current ||= crypto.randomUUID();
    retryBody.current ||= JSON.stringify({ clientRequestId: requestId.current, source, ...(source === "PACKING_MANUAL" ? { grinderUserId } : {}), ...(source === "COUNTER" && note.trim() ? { note: note.trim() } : {}), lines: snapshot.map((line) => ({ clientLineId: line.clientLineId, productId: line.product.id, productBarcode: line.product.barcode, blendGroupId: line.blendGroupId, mode: line.mode, grindId: line.grind?.id ?? null, grindBarcode: line.grind?.barcode ?? null, quantity: line.quantity })) });
    let completedBatch: string | null = null;
    try {
      // Persist before the request so a reload cannot generate a duplicate order.
      sessionStorage.setItem(storageKey, JSON.stringify({body:retryBody.current,lines:snapshot}));
      const result = await apiFetch<{ order: { id: string; order_no: string; total_bags: number; batch_id: string | null } }>("/api/orders", {
        method: "POST",
        body: retryBody.current,
      });
      if (!result.order || typeof result.order.order_no !== "string" || !Number.isInteger(result.order.total_bags) || (source === "PACKING_MANUAL" && !batchCompleteSchema.safeParse({clientRequestId:requestId.current,batchId:result.order.batch_id}).success)) throw new ApiError("ผลบันทึกไม่สมบูรณ์ กรุณายืนยันซ้ำด้วยรายการเดิม",502);
      sessionStorage.removeItem(storageKey);
      play("success");
      setMessage(`บันทึก ${result.order.order_no} สำเร็จ · ${result.order.total_bags} ถุง`);
      setLines([]); setNote(""); requestId.current = null; retryBody.current = null; setAwaitingRetry(false); setMonitorRevision(value=>value+1);
      if (source === "PACKING_MANUAL" && result.order.batch_id) {
        completedBatch = result.order.batch_id;
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
    // Navigation errors cannot turn a confirmed order into an ambiguous retry.
    if (completedBatch) {
      if (onCompleted) onCompleted(completedBatch);
      else router.push('/packing?batch=' + encodeURIComponent(completedBatch));
    }
  }, [source, storageKey, play, grinderUserId, note, recoveryRequired, router, onCompleted]);

  const confirmOrder = useCallback(async () => {
    if (product || quantityActive.current || document.querySelector("dialog[open]")) return;
    await executeOrder(lines);
  }, [product, executeOrder, lines]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "F10") { event.preventDefault(); if (!event.repeat && !quantityActive.current && !document.querySelector("dialog[open]")) void confirmOrder(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [confirmOrder]);

  const content = <>
    <main id="main" tabIndex={-1} className="workspace grid counter-layout">
      <section className="panel counter-composer"><div ref={composerRef} className="composer-content stack">
        <div className="composer-heading"><SoundControls sound={sound} onReady={()=>scanRef.current?.focus({preventScroll:true})} />
        <h2>{!product ? "1. สแกนบาร์โค้ดสินค้า" : mode === "GROUND" && !grind ? "2. เลือกวิธีเตรียมและเบอร์บด" : "3. เลือกจำนวน"}</h2>
          <div className="mode-tabs" aria-label="โหมดรับออเดอร์">
            <button type="button" className="button secondary" aria-pressed={orderMode === "SINGLE"} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (orderMode === "SINGLE") return; setOrderMode("SINGLE"); setActiveGroup(null); setMessage("โหมดกาแฟบดเดี่ยว — แต่ละ SKU แยกชุดของตัวเอง"); }}>กาแฟบดเดี่ยว</button>
            <button type="button" className="button secondary is-blend" aria-pressed={orderMode === "BLEND"} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (orderMode === "BLEND") return; setOrderMode("BLEND"); setActiveGroup(null); setMessage("โหมดกาแฟผสม — SKU ที่สแกนถัดไปจะรวมอยู่ชุดเดียวกัน"); }}>กาแฟผสม</button>
          </div>
        {onCancel && <button type="button" className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={cancelWorkspace}>กลับห้องแพ็ค</button>}
        </div>
        {product && <div className="product-result" role="status"><div><div className="product-name">{product.name}</div><div>{product.sku} · {product.barcode}</div></div>{isGround250(product.size_grams, mode) ? <SizeTag grams={product.size_grams} mode={mode} big /> : <div className="product-size">{product.size_grams} g</div>}</div>}
        <form onSubmit={submitScan} className="field">
          <label htmlFor="scan">{product ? (mode === "GROUND" ? "Grind Barcode — สแกนซ้ำเพื่อเปลี่ยนเบอร์ได้" : "พร้อมเพิ่มรายการเมล็ด") : "Product Barcode"}</label>
          <input ref={scanRef} id="scan" className="input scan-input" autoFocus inputMode={product ? "numeric" : "text"} autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} placeholder={product ? "สแกนเบอร์บด" : "สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้า"} />
        </form>
        {!product && /\D/.test(scan.trim()) && <ProductSearch query={scan.trim()} onSelect={selectProduct} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} />}
        {product && <div className="row" aria-label="วิธีเตรียมรายการ">
          <button type="button" className={`button ${mode === "GROUND" ? "" : "secondary"}`} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { setMode("GROUND"); setGrind(null); setQuantityError(""); }}>บดกาแฟ</button>
          <button type="button" className={`button ${mode === "WHOLE_BEAN" ? "" : "secondary"}`} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { setMode("WHOLE_BEAN"); setGrind(null); setQuantityError(""); openQuantity(null); }}>เมล็ด</button>
          {mode === "WHOLE_BEAN" && <button type="button" className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => openQuantity(null)}>เพิ่มเข้า{orderMode === "BLEND" && activeGroup ? "ชุดนี้" : "ชุด"}</button>}
          {orderMode === "BLEND" && activeGroup && <><span className="status info">ชุดที่ {groupsFor(lines).findIndex(group => group.groupId === activeGroup.id) + 1}</span><button type="button" className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={beginNewGroup}>สร้างชุดใหม่</button></>}
        </div>}
        {orderMode === "BLEND" && activeGroup && !product && <div className="row" aria-label="ชุดปัจจุบัน"><span className="status info">รายการถัดไปเข้าชุดที่ {groupsFor(lines).findIndex(group => group.groupId === activeGroup.id) + 1} · {activeGroup.mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${activeGroup.grind?.grind_value}`}</span><button type="button" className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={beginNewGroup}>สร้างชุดใหม่</button></div>}
        {mode === "GROUND" && <section className="barcode-drawer"><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} onSelect={selected => { if (product) openQuantity(selected); }} disabled={!product || busy || awaitingRetry || quantityOpen || recoveryRequired} /></section>}
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        {product && <>
          <div className="row">
            <label htmlFor="grind-select">เบอร์อื่น:</label>
            <select id="grind-select" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} className="select" style={{ width: "auto" }} value={grind?.id || ""} onChange={(event) => { const chosen=grinds.find(item=>item.id===event.target.value); if (chosen) openQuantity({...chosen,barcode:null}); else setGrind(null); }}><option value="">เลือกเบอร์บด</option>{dropdownGrinds(grinds).map((item) => <option key={item.id} value={item.id}>เบอร์ {item.grind_value}</option>)}</select>
            <button className="button secondary" disabled={busy} onClick={resetCurrent}>ยกเลิกรายการนี้</button>
          </div>
        </>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>ขนาด</th><th>วิธีเตรียม</th><th>ถุง</th><th>จัดการ</th></tr></thead><tbody>{groupsFor(lines).map((group, groupIndex) => { const skuCount = new Set(group.lines.map((item) => item.product.sku)).size; return <Fragment key={group.groupId}><tr className={`group-band${skuCount > 1 ? " is-blend" : ""}`}><td colSpan={5}><span className="band-parts">ชุดที่ {groupIndex + 1}<BlendBadge skuCount={skuCount} mode={group.mode} /><span className="muted">{group.mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${group.grind?.grind_value}`} · รวม {group.total} ถุง</span></span></td></tr>{group.lines.map((line) => <tr key={line.clientLineId}><td>{line.product.name}<br /><small>{line.product.sku}</small></td><td><SizeTag grams={line.product.size_grams} mode={line.mode} /></td><td>{line.mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${line.grind?.grind_value}`}</td><td>{line.quantity}</td><td><button className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return; setProduct(line.product); setMode(line.mode ?? "GROUND"); setGrind(line.grind); setActiveGroup({id:line.blendGroupId ?? line.clientLineId,mode:line.mode ?? "GROUND",grind:line.grind}); setEditingId(line.clientLineId); if (line.mode === "WHOLE_BEAN") { quantityActive.current=true; setQuantityOpen(true); } else if (line.grind) openQuantity(line.grind, line.quantity); }}>แก้ไข</button> <button className="button secondary" disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onClick={() => { if (operation.current || awaitingRetry || recoveryRequired || quantityActive.current) return; setLines((current) => current.filter((item) => item.clientLineId !== line.clientLineId)); requestId.current = null; }}>ลบ</button></td></tr>)}</Fragment>; })}</tbody></table>{!lines.length && <div className="empty">ยังไม่มีรายการ</div>}</div>
        {source === "COUNTER" && <div className="field"><label htmlFor="order-note">หมายเหตุออเดอร์ (ไม่บังคับ)</label><textarea id="order-note" className="input" rows={2} maxLength={500} value={note} disabled={busy || awaitingRetry || recoveryRequired} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ลูกค้าขอบดหยาบกว่าปกติ / รอรับหน้าร้าน" /><small>{note.trim().length}/500 · ห้องแพ็คจะเห็นหมายเหตุนี้</small></div>}
        {source === "PACKING_MANUAL" && <div className="field"><label htmlFor="grinder-select">ผู้รับผิดชอบงาน</label><select id="grinder-select" className="select" required value={grinderUserId} disabled={busy || awaitingRetry || quantityOpen || recoveryRequired} onChange={(event) => setGrinderUserId(event.target.value)}><option value="">เลือกผู้แพ็ค/ผู้บดก่อนยืนยัน</option>{grinderUserId && !grinders.some(item => item.id === grinderUserId) && <option value={grinderUserId}>ผู้รับผิดชอบที่บันทึกไว้ ({grinderUserId})</option>}{grinders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
        </div><div className="sticky-actions"><strong>รวม {total} ถุง</strong><button type="button" className="button secondary" onClick={()=>composerRef.current?.querySelector(product?".product-result":".data-table-wrap")?.scrollIntoView({block:"start"})}>ดู{product?"รายละเอียด":"รายการ"} ↓</button><button type="button" className="button large" disabled={!lines.length || busy || !!product || quantityOpen || recoveryRequired || (source === "PACKING_MANUAL" && !grinderUserId)} onClick={() => void confirmOrder()}>{busy ? "กำลังบันทึก..." : `ยืนยัน ${total} ถุง · F10`}</button></div>
      </section>
      <OrderMonitor revision={monitorRevision} />
    </main>
    {quantityOpen && product && (mode === "WHOLE_BEAN" || grind) && <QuantityDialog title={editingId ? "แก้ไขจำนวนถุง" : "เลือกจำนวนถุง"} description={`${product.name} · ${mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${grind?.grind_value}`}`} max={Math.min(99, Math.max(1, 500 - lines.filter(line => line.clientLineId !== editingId).reduce((sum, line) => sum + line.quantity, 0)))} initial={quantity} busy={busy} locked={awaitingRetry} error={quantityError} onConfirm={value => addLine(value, source === "PACKING_MANUAL")} onAddAnother={source === "PACKING_MANUAL" ? value => addLine(value) : undefined} confirmLabel={source === "PACKING_MANUAL" ? "ยืนยันออเดอร์ทั้งหมด" : undefined} onCancel={resetCurrent}>
      <p>{product.sku} · {product.size_grams} g · {activeGroup ? `ชุดที่ ${groupsFor(lines).findIndex(group => group.groupId === activeGroup.id) + 1}` : "ชุดใหม่"}</p>
      {source === "PACKING_MANUAL" && <div className="field"><label htmlFor="manual-grinder">ผู้รับผิดชอบงาน (ผู้แพ็ค/ผู้บด)</label><select id="manual-grinder" className="select" required value={grinderUserId} disabled={busy || awaitingRetry} onChange={event => setGrinderUserId(event.target.value)}><option value="">เลือกผู้รับผิดชอบ</option>{grinders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>ยืนยันออเดอร์ทั้งหมดจะรวมรายการนี้กับรายการก่อนหน้า {total} ถุง</small></div>}
    </QuantityDialog>}
  </>;
  return (embedded ?? !!onCompleted) ? content : <div className="app-shell operational-shell" data-density={uiConfig?.theme.density} data-button-size={uiConfig?.theme.buttonSize}><Topbar title={source === "COUNTER" ? "หน้าร้าน" : "เปิดออเดอร์ห้องแพ็ค"} profile={profile} uiConfig={uiConfig} />{content}</div>;
}
