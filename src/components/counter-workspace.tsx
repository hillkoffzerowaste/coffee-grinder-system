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
import { mergeBlendLine, productLine, flattenGroups, groupsFromLines, groupBags, groupSkuCount, groupPreparationLabel, isGround250, type BlendDraftLine, type DraftGroup, type BlendMode } from "@/lib/blend-orders";
import { apiFetch, ApiError } from "@/lib/api";
import { useScannerFocus, useScannerInput } from "@/lib/scanner";
import { batchCompleteSchema, orderSchema, pendingOrderSchema } from "@/lib/validation";
import type { GrindLookup, ProductLookup, Profile } from "@/lib/types";
import type { UiConfig } from "@/lib/ui-config";

const newGroup = (mode: BlendMode = "GROUND"): DraftGroup => ({ id: crypto.randomUUID(), mode, grind: null, lines: [] });

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
  // กาแฟบดเดี่ยวแยกชุดให้เองทุก SKU ส่วนกาแฟผสมต้องเปิดชุดเองแล้วค่อยเลือกรายการภายในชุด
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
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
          setGroups(groupsFromLines(pending.lines.map((line) => ({...line, blendGroupId: line.blendGroupId ?? line.clientLineId, mode: line.mode ?? "GROUND"}))));
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
  const lines = flattenGroups(groups);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  const filledGroups = groups.filter((group) => group.lines.length);
  const activeGroup = orderMode === "BLEND" ? groups.find((group) => group.id === activeGroupId) ?? null : null;
  // ชุดว่างยังไม่ได้เลขจริง เลขที่โชว์จึงต้องนับเฉพาะชุดที่มีของ ให้ตรงกับ blend_group_no ของห้องแพ็ค
  const setNumber = (group: DraftGroup) => groups.slice(0, groups.indexOf(group)).filter((item) => item.lines.length).length + 1;
  const locked = busy || awaitingRetry || quantityOpen || recoveryRequired;
  const blocked = () => !ready.current || operation.current || awaitingRetry || recoveryRequired || quantityActive.current;
  const editingLine = editingId ? lines.find((line) => line.clientLineId === editingId) ?? null : null;
  const editingGroup = editingLine ? groups.find((group) => group.id === editingLine.blendGroupId) ?? null : null;
  const itemModeOpen = orderMode === "SINGLE" && (!editingGroup || editingGroup.lines.length <= 1);

  function resetCurrent() {
    quantityActive.current = false;
    setQuantityOpen(false); setQuantityError("");
    setProduct(null); setGrind(null); setQuantity(1); setScan(""); setEditingId(null);
    if (scanRef.current) scanRef.current.value = "";
    setTimeout(() => scanRef.current?.focus({ preventScroll: true }), 0);
  }

  function openQuantity(selectedGrind: GrindLookup | null, initial = 1) {
    if (blocked()) return;
    setGrind(selectedGrind); setQuantity(initial); setQuantityError("");
    quantityActive.current = true;
    setQuantityOpen(true);
  }

  function commitGroups(next: DraftGroup[]) {
    setGroups(next);
    requestId.current = null;
  }

  function chooseOrderMode(next: "SINGLE" | "BLEND") {
    if (locked || blocked() || next === orderMode) return;
    resetCurrent(); setError(""); setMode("GROUND"); setOrderMode(next);
    // ชุดว่างที่ค้างจากโหมดผสมไม่มีงานจริง ทิ้งไปพร้อมกับการสลับโหมด
    const kept = groups.filter((group) => group.lines.length);
    if (next === "SINGLE") {
      setGroups(kept); setActiveGroupId(null);
      setMessage("โหมดกาแฟบดเดี่ยว — แต่ละ SKU แยกชุดของตัวเอง");
      return;
    }
    const group = newGroup();
    setGroups([...kept, group]); setActiveGroupId(group.id);
    setMessage(`โหมดกาแฟผสม — เปิดชุดที่ ${kept.length + 1} ให้แล้ว เลือกรายการภายในชุดนี้ได้เลย`);
  }

  // ชุดว่างซ้อนกันทำให้เลขชุดเลื่อนโดยไม่มีงานจริง เปิดชุดใหม่ได้เมื่อชุดที่ถืออยู่มีของแล้ว
  function openNewGroup() {
    if (locked || blocked() || orderMode !== "BLEND") return;
    if (activeGroup && !activeGroup.lines.length) { setError(""); setMessage(`ชุดที่ ${setNumber(activeGroup)} ยังว่างอยู่ — เพิ่มสินค้าเข้าชุดนี้ก่อน`); return; }
    if (groups.length >= 100) { setError("หนึ่งออเดอร์รองรับไม่เกิน 100 รายการ"); return; }
    resetCurrent(); setMode("GROUND");
    const group = newGroup();
    setGroups([...groups, group]); setActiveGroupId(group.id);
    setError(""); setMessage(`เปิดชุดที่ ${filledGroups.length + 1} แล้ว — สแกนสินค้าเข้าชุดนี้`);
  }

  function focusGroup(group: DraftGroup) {
    if (locked || blocked() || orderMode !== "BLEND" || group.id === activeGroupId) return;
    resetCurrent(); setActiveGroupId(group.id); setMode(group.mode); setError("");
    setMessage(`รายการถัดไปจะเข้าชุดที่ ${setNumber(group)}`);
  }

  function removeGroup(group: DraftGroup) {
    if (locked || blocked()) return;
    if (group.lines.length && !window.confirm("ลบทั้งชุดพร้อมรายการในชุดนี้หรือไม่?")) return;
    resetCurrent(); commitGroups(groups.filter((item) => item.id !== group.id));
    if (group.id === activeGroupId) setActiveGroupId(null);
    setMessage("ลบชุดแล้ว");
  }

  function chooseGroupMode(next: BlendMode) {
    if (locked || blocked() || !activeGroup || next === activeGroup.mode) return;
    if (activeGroup.lines.length) { setError("ชุดนี้มีรายการแล้ว เปลี่ยนวิธีเตรียมไม่ได้ — ให้เปิดชุดใหม่แทน"); return; }
    setError(""); setQuantityError(""); setGrind(null); setMode(next);
    commitGroups(groups.map((group) => group.id === activeGroup.id ? { ...group, mode: next, grind: null } : group));
    if (product && next === "WHOLE_BEAN") openQuantity(null);
  }

  async function submitScan(event: React.FormEvent) {
    event.preventDefault();
    const value = (scanRef.current?.value ?? scan).trim();
    if (!value || blocked()) return;
    if (!product && /\D/.test(value)) return;
    operation.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!product) {
        const result = await apiFetch<{ product: ProductLookup }>(`/api/catalog/product/${encodeURIComponent(value)}`);
        setProduct(result.product); setGrind(null); setQuantity(1);
        setMode(activeGroup ? activeGroup.mode : "GROUND");
        composerRef.current?.scrollTo({ top: 0 });
        composerRef.current?.firstElementChild?.scrollIntoView({ block: "start" });
        // ชุดเมล็ดเลือกวิธีเตรียมไว้ที่หัวชุดแล้ว เหลือแค่จำนวน
        if (activeGroup?.mode === "WHOLE_BEAN") { setQuantityError(""); quantityActive.current = true; setQuantityOpen(true); }
      } else {
        if (mode === "WHOLE_BEAN") throw new Error("รายการนี้เป็นเมล็ด ไม่ต้องสแกนเบอร์บด");
        const result = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(value)}`);
        setGrind(result.grind); setQuantity(1); setQuantityError("");
        quantityActive.current = true; setQuantityOpen(true);
      }
      setScan(""); if (scanRef.current) scanRef.current.value = ""; play("success");
    } catch (error) { if(product)setGrind(null); play("error"); setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); setTimeout(() => { if (!quantityActive.current) scanRef.current?.focus({ preventScroll: true }); }, 0); }
  }

  function selectProduct(selected: ProductLookup) {
    if (blocked()) return;
    setProduct(selected); setGrind(null); setQuantity(1); setEditingId(null); setScan(""); setError(""); setMessage("");
    setMode(activeGroup ? activeGroup.mode : "GROUND");
    if (scanRef.current) scanRef.current.value = "";
    if (activeGroup?.mode === "WHOLE_BEAN") { openQuantity(null); return; }
    composerRef.current?.scrollTo({ top: 0 });
    composerRef.current?.firstElementChild?.scrollIntoView({ block: "start" });
    scanRef.current?.focus({ preventScroll: true });
  }

  function editLine(line: BlendDraftLine) {
    if (blocked()) return;
    if (orderMode === "BLEND") setActiveGroupId(line.blendGroupId);
    setProduct(line.product); setMode(line.mode ?? "GROUND"); setGrind(line.grind); setEditingId(line.clientLineId);
    if (line.mode === "WHOLE_BEAN") { setQuantity(line.quantity); setQuantityError(""); quantityActive.current = true; setQuantityOpen(true); }
    else if (line.grind) openQuantity(line.grind, line.quantity);
  }

  function removeLine(line: BlendDraftLine) {
    if (blocked()) return;
    commitGroups(groups.flatMap((group) => {
      if (group.id !== line.blendGroupId) return [group];
      const kept = group.lines.filter((item) => item.clientLineId !== line.clientLineId);
      // ชุดที่หมดของแล้วต้องหายไปด้วย ไม่งั้นเลขชุดที่หน้าร้านเห็นจะเลื่อนหนีห้องแพ็ค
      return kept.length || group.id === activeGroupId ? [{ ...group, lines: kept }] : [];
    }));
  }

  function cancelWorkspace() {
    if (!ready.current || operation.current || retryBody.current || awaitingRetry || quantityActive.current || recoveryRequired) return;
    if ((lines.length || product || scan.trim()) && !window.confirm("มีรายการที่ยังไม่ได้บันทึก ต้องการยกเลิกและกลับห้องแพ็คหรือไม่?")) return;
    onCancel?.();
  }

  function addLine(quantity: number) {
    if (!quantityActive.current || operation.current || awaitingRetry || recoveryRequired || !product || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)) return;
    if (source === "PACKING_MANUAL" && !grinderUserId) { setQuantityError("กรุณาเลือกผู้แพ็ค/ผู้บดก่อนยืนยัน"); return; }
    const lineGrind = mode === "GROUND" ? grind : null;
    if (mode === "GROUND" && !lineGrind) { setQuantityError("กรุณาเลือกเบอร์บดก่อนยืนยัน"); return; }
    const remaining = lines.filter(line => line.clientLineId !== editingId);
    if (remaining.length >= 100 || remaining.reduce((sum, line) => sum + line.quantity, quantity) > 500) {
      setQuantityError("หนึ่งออเดอร์รองรับไม่เกิน 100 รายการ และ 500 ถุง"); return;
    }
    // แก้ไขรายการเดิมต้องอยู่ชุดเดิมเสมอ ส่วนรายการใหม่: โหมดผสมเข้าชุดที่เปิดอยู่ โหมดเดี่ยวแยกชุดของตัวเอง
    const target = editingGroup ?? activeGroup;
    const line = productLine(product, target?.id ?? crypto.randomUUID(), mode, lineGrind, quantity, editingId || crypto.randomUUID());
    const nextGroups = target
      ? groups.map((group) => group.id !== target.id ? group : {
          ...group,
          mode: group.lines.length > 1 ? group.mode : mode,
          // เบอร์ล่าสุดเป็นแค่ค่าตั้งต้นของรายการถัดไป รายการอื่นในชุดยังถือเบอร์ของตัวเองไว้
          grind: lineGrind ?? group.grind,
          lines: editingId ? group.lines.map((item) => item.clientLineId === editingId ? line : item) : mergeBlendLine(group.lines, line),
        })
      : [...groups, { id: line.blendGroupId, mode, grind: lineGrind, lines: [line] }];
    commitGroups(nextGroups);
    resetCurrent();
  }

  const executeOrder = useCallback(async (snapshot: BlendDraftLine[]) => {
    if (!ready.current || !snapshot.length || operation.current || recoveryRequired) return;
    if (source === "PACKING_MANUAL" && !grinderUserId) {
      setError("กรุณาเลือกผู้แพ็ค/ผู้บดก่อนยืนยันออเดอร์"); return;
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
      setGroups([]); setActiveGroupId(null); setOrderMode("SINGLE"); setMode("GROUND");
      setNote(""); requestId.current = null; retryBody.current = null; setAwaitingRetry(false); setMonitorRevision(value=>value+1);
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
        <h2>{!product ? (activeGroup ? `1. สแกนสินค้าเข้าชุดที่ ${setNumber(activeGroup)}` : "1. สแกนบาร์โค้ดสินค้า") : mode === "GROUND" && !grind ? (orderMode === "BLEND" ? "2. เลือกเบอร์บดของรายการนี้" : "2. เลือกวิธีเตรียมและเบอร์บด") : "3. เลือกจำนวน"}</h2>
          <div className="mode-tabs" aria-label="โหมดรับออเดอร์">
            <button type="button" className="button secondary" aria-pressed={orderMode === "SINGLE"} disabled={locked} onClick={() => chooseOrderMode("SINGLE")}>กาแฟบดเดี่ยว</button>
            <button type="button" className="button secondary is-blend" aria-pressed={orderMode === "BLEND"} disabled={locked} onClick={() => chooseOrderMode("BLEND")}>กาแฟผสม</button>
          </div>
        {onCancel && <button type="button" className="button secondary" disabled={locked} onClick={cancelWorkspace}>กลับห้องแพ็ค</button>}
        </div>
        {activeGroup && <div className="mode-tabs" aria-label={`ชุดที่ ${setNumber(activeGroup)}`}>
          <span className="status info">ชุดที่ {setNumber(activeGroup)}</span>
          <button type="button" className="button secondary" aria-pressed={activeGroup.mode === "GROUND"} disabled={locked || !!activeGroup.lines.length} onClick={() => chooseGroupMode("GROUND")}>บดกาแฟ</button>
          <button type="button" className="button secondary" aria-pressed={activeGroup.mode === "WHOLE_BEAN"} disabled={locked || !!activeGroup.lines.length} onClick={() => chooseGroupMode("WHOLE_BEAN")}>เมล็ด</button>
          <button type="button" className="button secondary" disabled={locked} onClick={openNewGroup}>เปิดชุดใหม่</button>
        </div>}
        {product && <div className="product-result" role="status"><div><div className="product-name">{product.name}</div><div>{product.sku} · {product.barcode}</div></div>{isGround250(product.size_grams, mode) ? <SizeTag grams={product.size_grams} mode={mode} big /> : <div className="product-size">{product.size_grams} g</div>}</div>}
        <form onSubmit={submitScan} className="field">
          <label htmlFor="scan">{product ? (mode === "GROUND" ? "Grind Barcode — สแกนซ้ำเพื่อเปลี่ยนเบอร์ได้" : "พร้อมเพิ่มรายการเมล็ด") : "Product Barcode"}</label>
          <input ref={scanRef} id="scan" className="input scan-input" autoFocus inputMode={product ? "numeric" : "text"} autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={locked} placeholder={product ? "สแกนเบอร์บด" : "สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้า"} />
        </form>
        {!product && /\D/.test(scan.trim()) && <ProductSearch query={scan.trim()} onSelect={selectProduct} disabled={locked} />}
        {product && itemModeOpen && <div className="row" aria-label="วิธีเตรียมรายการ">
          <button type="button" className={`button ${mode === "GROUND" ? "" : "secondary"}`} disabled={locked} onClick={() => { setMode("GROUND"); setGrind(null); setQuantityError(""); }}>บดกาแฟ</button>
          <button type="button" className={`button ${mode === "WHOLE_BEAN" ? "" : "secondary"}`} disabled={locked} onClick={() => { setMode("WHOLE_BEAN"); setGrind(null); setQuantityError(""); openQuantity(null); }}>เมล็ด</button>
          {mode === "WHOLE_BEAN" && <button type="button" className="button secondary" disabled={locked} onClick={() => openQuantity(null)}>เพิ่มเข้าชุด</button>}
        </div>}
        {product && activeGroup && activeGroup.mode === "GROUND" && <div className="row" aria-label="เบอร์บดของรายการนี้">
          {activeGroup.grind && <button type="button" className="button" disabled={locked} onClick={() => openQuantity(activeGroup.grind)}>ใช้เบอร์เดิม · เบอร์ {activeGroup.grind.grind_value}</button>}
          <span className="muted">ชุดเดียวใส่ได้หลายเบอร์ — สแกนหรือเลือกเบอร์ใหม่จะเปลี่ยนเฉพาะรายการนี้</span>
        </div>}
        {product && activeGroup && activeGroup.mode === "WHOLE_BEAN" && <div className="row"><button type="button" className="button" disabled={locked} onClick={() => openQuantity(null)}>เพิ่มเข้าชุดที่ {setNumber(activeGroup)}</button></div>}
        {mode === "GROUND" && <section className="barcode-drawer"><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} onSelect={selected => { if (product) openQuantity(selected); }} disabled={!product || locked} /></section>}
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        {product && <>
          <div className="row">
            <label htmlFor="grind-select">เบอร์อื่น:</label>
            <select id="grind-select" disabled={locked} className="select" style={{ width: "auto" }} value={grind?.id || ""} onChange={(event) => { const chosen=grinds.find(item=>item.id===event.target.value); if (chosen) openQuantity({...chosen,barcode:null}); else setGrind(null); }}><option value="">เลือกเบอร์บด</option>{dropdownGrinds(grinds).map((item) => <option key={item.id} value={item.id}>เบอร์ {item.grind_value}</option>)}</select>
            <button className="button secondary" disabled={busy} onClick={resetCurrent}>ยกเลิกรายการนี้</button>
          </div>
        </>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>ขนาด</th><th>วิธีเตรียม</th><th>ถุง</th><th>จัดการ</th></tr></thead><tbody>{groups.map((group) => { const skuCount = groupSkuCount(group); const isActive = group.id === activeGroup?.id; return <Fragment key={group.id}><tr className={`group-band${skuCount > 1 ? " is-blend" : ""}${isActive ? " is-active" : ""}`}><td colSpan={5}><span className="band-parts">ชุดที่ {setNumber(group)}<BlendBadge skuCount={skuCount} mode={group.mode} /><span className="muted">{groupPreparationLabel(group)} · รวม {groupBags(group)} ถุง</span>{orderMode === "BLEND" && (isActive ? <span className="status info">กำลังเพิ่มเข้าชุดนี้</span> : <button type="button" className="button secondary" disabled={locked} onClick={() => focusGroup(group)}>เพิ่มเข้าชุดนี้</button>)}{orderMode === "BLEND" && <button type="button" className="button secondary" disabled={locked} onClick={() => removeGroup(group)}>ลบชุด</button>}{!group.lines.length && <span className="muted">ยังไม่มีรายการในชุดนี้</span>}</span></td></tr>{group.lines.map((line) => <tr key={line.clientLineId}><td>{line.product.name}<br /><small>{line.product.sku}</small></td><td><SizeTag grams={line.product.size_grams} mode={line.mode} /></td><td>{line.mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${line.grind?.grind_value}`}</td><td>{line.quantity}</td><td><button className="button secondary" disabled={locked} onClick={() => editLine(line)}>แก้ไข</button> <button className="button secondary" disabled={locked} onClick={() => removeLine(line)}>ลบ</button></td></tr>)}</Fragment>; })}</tbody></table>{!lines.length && <div className="empty">ยังไม่มีรายการ</div>}</div>
        {source === "COUNTER" && <div className="field"><label htmlFor="order-note">หมายเหตุออเดอร์ (ไม่บังคับ)</label><textarea id="order-note" className="input" rows={2} maxLength={500} value={note} disabled={busy || awaitingRetry || recoveryRequired} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ลูกค้าขอบดหยาบกว่าปกติ / รอรับหน้าร้าน" /><small>{note.trim().length}/500 · ห้องแพ็คจะเห็นหมายเหตุนี้</small></div>}
        {source === "PACKING_MANUAL" && <div className="field"><label htmlFor="grinder-select">ผู้แพ็ค/ผู้บด</label><select id="grinder-select" className="select" required value={grinderUserId} disabled={locked} onChange={(event) => setGrinderUserId(event.target.value)}><option value="">เลือกผู้แพ็ค/ผู้บดก่อนยืนยัน</option>{grinderUserId && !grinders.some(item => item.id === grinderUserId) && <option value={grinderUserId}>ผู้รับผิดชอบที่บันทึกไว้ ({grinderUserId})</option>}{grinders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
        </div><div className="sticky-actions"><strong>{orderMode === "BLEND" ? `${filledGroups.length} ชุด · ` : ""}รวม {total} ถุง</strong><button type="button" className="button secondary" onClick={()=>composerRef.current?.querySelector(product?".product-result":".data-table-wrap")?.scrollIntoView({block:"start"})}>ดู{product?"รายละเอียด":"รายการ"} ↓</button><button type="button" className="button large" disabled={!lines.length || busy || !!product || quantityOpen || recoveryRequired || (source === "PACKING_MANUAL" && !grinderUserId)} onClick={() => void confirmOrder()}>{busy ? "กำลังบันทึก..." : `ยืนยัน ${total} ถุง · F10`}</button></div>
      </section>
      <OrderMonitor revision={monitorRevision} />
    </main>
    {quantityOpen && product && (mode === "WHOLE_BEAN" || grind) && <QuantityDialog title={editingId ? "แก้ไขจำนวนถุง" : "เลือกจำนวนถุง"} description={`${product.name} · ${mode === "WHOLE_BEAN" ? "เมล็ด" : `บดเบอร์ ${grind?.grind_value}`}`} max={Math.min(99, Math.max(1, 500 - lines.filter(line => line.clientLineId !== editingId).reduce((sum, line) => sum + line.quantity, 0)))} initial={quantity} busy={busy} locked={awaitingRetry} error={quantityError} onConfirm={value => addLine(value)} onAddAnother={orderMode === "BLEND" || source === "PACKING_MANUAL" ? value => addLine(value) : undefined} hideConfirm={source === "PACKING_MANUAL" || (source === "COUNTER" && orderMode === "BLEND")} onCancel={resetCurrent}>
      <p>{product.sku} · {product.size_grams} g · {editingGroup ? `ชุดที่ ${setNumber(editingGroup)}` : activeGroup ? `ชุดที่ ${setNumber(activeGroup)}` : "ชุดใหม่"}</p>
      {source === "PACKING_MANUAL" && <div className="field"><label htmlFor="manual-grinder">ผู้แพ็ค/ผู้บด</label><select id="manual-grinder" className="select" required value={grinderUserId} disabled={busy || awaitingRetry} onChange={event => setGrinderUserId(event.target.value)}><option value="">เลือกผู้แพ็ค/ผู้บด</option>{grinders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>เพิ่มรายการนี้รวมกับรายการก่อนหน้า {total} ถุง แล้วใช้ปุ่มยืนยันรวมด้านล่าง</small></div>}
    </QuantityDialog>}
  </>;
  return (embedded ?? !!onCompleted) ? content : <div className="app-shell operational-shell" data-density={uiConfig?.theme.density} data-button-size={uiConfig?.theme.buttonSize}><Topbar title={source === "COUNTER" ? "หน้าร้าน" : "เปิดออเดอร์ห้องแพ็ค"} profile={profile} uiConfig={uiConfig} />{content}</div>;
}
