"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/topbar";
import { GrindBarcodes } from "@/components/grind-barcodes";
import { SoundControls } from "@/components/sound-controls";
import { useSounds } from "@/lib/use-sounds";
import { useCatalog } from "@/lib/use-catalog";
import { apiFetch } from "@/lib/api";
import { useScannerInput } from "@/lib/scanner";
import type { BagJob, GrindLookup, JobStatus, Profile } from "@/lib/types";

const nextAction: Partial<Record<JobStatus, { label: string; next: JobStatus }>> = {
  QUEUED: { label: "รับงาน", next: "CLAIMED" },
  CLAIMED: { label: "เริ่มบด", next: "GRINDING" },
  GRINDING: { label: "บดเสร็จ", next: "GROUND" },
  GROUND: { label: "เริ่มแพ็ค", next: "PACKING" },
  PACKING: { label: "แพ็คเสร็จ", next: "COMPLETED" },
};

export function PackingWorkspace({ profile }: { profile: Profile }) {
  const [jobs, setJobs] = useState<BagJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [filter, setFilter] = useState("");
  const {grinds,grinders,catalogError,reloadCatalog}=useCatalog();
  const sound=useSounds();
  const {play}=sound;
  const queueWatermark=useRef<bigint|null>(null);
  const [grinderId, setGrinderId] = useState("");
  const [verifiedGrind, setVerifiedGrind] = useState<GrindLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  useScannerInput(scanRef, setScan);
  const selectedRef = useRef<string | null>(null);
  const operation = useRef(false);
  function selectJob(id: string | null) {
    if (operation.current) return;
    selectedRef.current = id; setSelected(id); setVerifiedGrind(null);
  }
  const job = jobs.find((item) => item.id === selected);
  const action = job ? nextAction[job.status] : undefined;
  const visible = filter ? jobs.filter((item) => item.product_barcode_snapshot === filter || String(item.queue_seq) === filter || item.id === filter) : jobs;

  const acceptJobs=useCallback((result:{jobs:BagJob[];latestQueueSeq?:string})=>{
    const newest=result.latestQueueSeq!==undefined?BigInt(result.latestQueueSeq):result.jobs.reduce((max,job)=>BigInt(job.queue_seq)>max?BigInt(job.queue_seq):max,0n);
    if(queueWatermark.current!==null&&newest>queueWatermark.current)play("newJob");
    queueWatermark.current=queueWatermark.current===null||newest>queueWatermark.current?newest:queueWatermark.current;
    setJobs(result.jobs);setLastSync(new Date().toLocaleTimeString("th-TH"));
  },[play]);
  const load = useCallback(async () => {
    try {
      const result = await apiFetch<{ jobs: BagJob[];latestQueueSeq:string }>("/api/jobs");
      acceptJobs(result);
    } catch (error) { setError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); }
  }, [acceptJobs]);
  useEffect(() => {
    let active = true;
    void apiFetch<{ jobs: BagJob[];latestQueueSeq:string }>("/api/jobs").then((data) => {
      if (active) acceptJobs(data);
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ");
    });
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [load,acceptJobs]);

  async function onScan(event: React.FormEvent) {
    event.preventDefault();
    const scannedValue = (scanRef.current?.value ?? scan).trim();
    if (!scannedValue || operation.current) return;
    setError("");
    if (job?.status === "CLAIMED") {
      operation.current = true;
      const scannedJobId = job.id;
      setVerifiedGrind(null);
      setBusy(true);
      try {
        const { grind } = await apiFetch<{ grind: GrindLookup }>(`/api/catalog/grind/${encodeURIComponent(scannedValue)}`);
        if (grind.grind_value !== job.grind_value_snapshot) throw new Error(`เบอร์บดไม่ตรงใบงาน — ต้องเป็นเบอร์ ${job.grind_value_snapshot}`);
        if (selectedRef.current === scannedJobId) { setVerifiedGrind(grind); setScan(""); play("success"); }
      } catch (error) { play("error");setError(error instanceof Error ? error.message : "สแกนไม่สำเร็จ"); }
      finally { operation.current = false; setBusy(false); }
    } else {
      const value = scannedValue;
      const matches = jobs.filter((item) => item.product_barcode_snapshot === value || String(item.queue_seq) === value || item.id === value);
      play(matches.length?"success":"error");
      setFilter(value); setScan(""); setVerifiedGrind(null);
      if (matches.length === 1) selectJob(matches[0].id);
      else { selectJob(null); if (!matches.length) setError("ไม่พบงานที่ตรงบาร์โค้ด"); }
    }
    scanRef.current?.focus();
  }

  async function transition() {
    if (!job || !action || operation.current) return;
    if (action.next === "GRINDING" && (!verifiedGrind || !grinderId)) { play("error");setError("สแกนเบอร์บดและเลือกคนบดก่อนเริ่มงาน"); return; }
    operation.current = true; setBusy(true); setError("");
    try {
      await apiFetch(`/api/jobs/${job.id}/transition`, { method: "POST", body: JSON.stringify({ expectedStatus: job.status, nextStatus: action.next, grinderUserId: grinderId || undefined, grindId: verifiedGrind?.id }) });
      play("success");await load();
      if (action.next === "COMPLETED") { selectedRef.current = null; setSelected(null); setFilter(""); setVerifiedGrind(null); }
      scanRef.current?.focus();
    } catch (error) { play("error");setError(error instanceof Error ? error.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); }
  }

  return <div className="app-shell"><Topbar title="ห้องแพ็ค" profile={profile} /><main id="main" tabIndex={-1} className="workspace grid">
    <section className="panel stack">
      <SoundControls sound={sound} onReady={()=>scanRef.current?.focus()} />
      <div className="row"><h2>คิวงานบด / แพ็ค</h2><Link className="button secondary" href="/packing/new">เปิดออเดอร์เอง</Link><button className="button secondary" disabled={busy} onClick={() => { if (operation.current) return; setFilter(""); selectJob(null); setVerifiedGrind(null); }}>แสดงทุกงาน</button></div>
      <form className="field" onSubmit={onScan}><label htmlFor="packing-scan">{job?.status === "CLAIMED" ? `สแกนเบอร์บด ${job.grind_value_snapshot}` : "สแกน Product Barcode / เลขคิว"}</label><input ref={scanRef} id="packing-scan" className="input scan-input" autoFocus autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy} /></form>
      <GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} />
      {error && <div role="alert" className="notice error">{error}</div>}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>คิว</th><th>สินค้า</th><th>ขนาด</th><th>เบอร์บด</th><th>สถานะ</th><th></th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td>#{item.queue_seq}</td><td>{item.product_name_snapshot}<br /><small>{item.sku_snapshot}</small></td><td>{item.size_grams_snapshot} g</td><td>{item.grind_value_snapshot}</td><td><span className="status">{item.status}</span></td><td><button className="button secondary" disabled={busy} onClick={() => selectJob(item.id)}>เปิดงาน</button></td></tr>)}</tbody></table>{!visible.length && <div className="empty">ไม่มีงานในคิวนี้</div>}</div>
      <small>อัปเดตล่าสุด {lastSync || "กำลังเชื่อมต่อ..."} · โหลดข้อมูลซ้ำทุก 5 วินาที</small>
    </section>
    <aside className="panel stack"><h2>งานที่เลือก</h2>{job ? <><strong className="product-name">คิว #{job.queue_seq}</strong><div>{job.product_name_snapshot}</div><div className="product-size">{job.size_grams_snapshot} g · เบอร์ {job.grind_value_snapshot}</div><span className="status">{job.status}</span>{job.status === "CLAIMED" && <><div className={verifiedGrind ? "notice success" : "notice"}>{verifiedGrind ? "ตรวจเบอร์บดแล้ว" : "รอสแกนเบอร์บด"}</div><div className="field"><label htmlFor="grinder">คนบด</label><select id="grinder" className="select" value={grinderId} onChange={(event) => setGrinderId(event.target.value)}><option value="">เลือกคนบด</option>{grinders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></>}{action && <button className="button large" disabled={busy} onClick={() => void transition()}>{busy ? "กำลังบันทึก..." : action.label}</button>}</> : <div className="empty">สแกนหรือเลือกงานจากคิว</div>}</aside>
  </main></div>;
}
