"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { jobStatusLabels } from "@/lib/job-status";
import { dropdownGrinds } from "@/lib/grind-options";
import { Topbar } from "@/components/topbar";
import { GrindBarcodes } from "@/components/grind-barcodes";
import { SoundControls } from "@/components/sound-controls";
import { useSounds } from "@/lib/use-sounds";
import { useQueueAlarm } from "@/lib/use-queue-alarm";
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
  const [queuedCount,setQueuedCount]=useState(0);
  const queueRequest=useRef(0);
  const invalidateQueue=useCallback(()=>{++queueRequest.current;},[]);
  useQueueAlarm(queuedCount>0,sound.enabled,play);
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

  const acceptJobs=useCallback((result:{jobs:BagJob[];queuedCount?:number})=>{
    setQueuedCount(result.queuedCount??result.jobs.filter(job=>job.status==="QUEUED").length);
    setJobs(result.jobs);setLastSync(new Date().toLocaleTimeString("th-TH"));
  },[]);
  const load = useCallback(async () => {
    const request=++queueRequest.current;
    try {
      const result = await apiFetch<{ jobs: BagJob[];queuedCount:number }>("/api/jobs");
      if(request===queueRequest.current)acceptJobs(result);
    } catch (error) { if(request===queueRequest.current)setError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); }
  }, [acceptJobs]);
  useEffect(() => {
    let active = true;
    const request=++queueRequest.current;
    void apiFetch<{ jobs: BagJob[];queuedCount:number }>("/api/jobs").then((data) => {
      if (active&&request===queueRequest.current) acceptJobs(data);
    }).catch((error: unknown) => {
      if (active&&request===queueRequest.current) setError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ");
    });
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; invalidateQueue();clearInterval(timer); };
  }, [load,acceptJobs,invalidateQueue]);

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

  function selectGrind(grind:GrindLookup) {
    if(operation.current||job?.status!=="CLAIMED")return;
    setVerifiedGrind(null);
    if(grind.grind_value!==job.grind_value_snapshot){setError(`เบอร์บดไม่ตรงใบงาน — ต้องเป็นเบอร์ ${job.grind_value_snapshot}`);play("error");return;}
    setVerifiedGrind(grind);setError("");play("success");
  }

  async function transition() {
    if (!job || !action || operation.current) return;
    if (action.next === "GRINDING" && (!verifiedGrind || !grinderId)) { play("error");setError("เลือกหรือสแกนเบอร์บด และเลือกคนบดก่อนเริ่มงาน"); return; }
    operation.current = true; setBusy(true); setError("");
    try {
      await apiFetch(`/api/jobs/${job.id}/transition`, { method: "POST", body: JSON.stringify({ expectedStatus: job.status, nextStatus: action.next, grinderUserId: grinderId || undefined, grindId: verifiedGrind?.id }) });
      play("success");await load();
      if (action.next === "COMPLETED") { selectedRef.current = null; setSelected(null); setFilter(""); setVerifiedGrind(null); }
      scanRef.current?.focus();
    } catch (error) { play("error");setError(error instanceof Error ? error.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { operation.current = false; setBusy(false); }
  }

  return <div className="app-shell operational-shell"><Topbar title="ห้องแพ็ค" profile={profile} /><main id="main" tabIndex={-1} className="workspace grid packing-layout">
    <section className="panel packing-queue">
      <SoundControls sound={sound} onReady={()=>scanRef.current?.focus()} />
      <div className="row"><h2>คิวงานบด / แพ็ค</h2><Link className="button secondary" href="/packing/new">เปิดออเดอร์เอง</Link><button className="button secondary" disabled={busy} onClick={() => { if (operation.current) return; setFilter(""); selectJob(null); setVerifiedGrind(null); }}>แสดงทุกงาน</button></div>
      <form className="field" onSubmit={onScan}><label htmlFor="packing-scan">{job?.status === "CLAIMED" ? `สแกนเบอร์บด ${job.grind_value_snapshot}` : "สแกน Product Barcode / เลขคิว"}</label><input ref={scanRef} id="packing-scan" className="input scan-input" autoFocus autoComplete="off" value={scan} onChange={(event) => setScan(event.target.value)} disabled={busy} /></form>
      <details className="barcode-drawer"><summary>แสดงบาร์โค้ดเบอร์บด</summary><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} /></details>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>คิว</th><th>สินค้า</th><th>ขนาด</th><th>เบอร์บด</th><th>สถานะ</th><th></th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td>#{item.queue_seq}</td><td>{item.product_name_snapshot}<br /><small>{item.sku_snapshot}</small></td><td>{item.size_grams_snapshot} g</td><td>{item.grind_value_snapshot}</td><td><span className="status">{jobStatusLabels[item.status]}</span></td><td><button className="button secondary" disabled={busy} onClick={() => selectJob(item.id)}>เปิดงาน</button></td></tr>)}</tbody></table>{!visible.length && <div className="empty">ไม่มีงานในคิวนี้</div>}</div>
      <small>อัปเดตล่าสุด {lastSync || "กำลังเชื่อมต่อ..."} · โหลดข้อมูลซ้ำทุก 5 วินาที</small>
    </section>
    <aside className="panel packing-detail">
      <h2>งานที่เลือก</h2>
      <div className="detail-content">{job ? <>
        <strong>คิว #{job.queue_seq} · {jobStatusLabels[job.status]}</strong>
        <div className="product-name">{job.product_name_snapshot}</div>
        <div className="product-size">{job.size_grams_snapshot} g · เบอร์ {job.grind_value_snapshot}</div>
        {job.status==="CLAIMED" && <>
          <div className={verifiedGrind?"notice success":"notice"}>{verifiedGrind?"ตรวจเบอร์บดแล้ว":"เลือกเบอร์บดด้านล่าง หรือสแกนบาร์โค้ด"}</div>
          <div className="row" role="group" aria-label="เลือกเบอร์บด">
            {grinds.filter(grind=>["6","8","10","12","15"].includes(grind.grind_value)).map(grind=><button type="button" className="button secondary" key={grind.id} disabled={busy} aria-pressed={verifiedGrind?.id===grind.id} onClick={()=>selectGrind(grind)}>เบอร์ {grind.grind_value}</button>)}
          </div>
          <div className="field"><label htmlFor="packing-grind-select">เลือกเบอร์บดเอง (5–17)</label><select id="packing-grind-select" className="select" disabled={busy} value={verifiedGrind?.id||""} onChange={event=>{
            const chosen=grinds.find(grind=>grind.id===event.target.value);
            if(chosen)selectGrind({...chosen,barcode:null});else setVerifiedGrind(null);
          }}><option value="">เลือกเบอร์บด</option>{dropdownGrinds(grinds).map(grind=><option key={grind.id} value={grind.id}>เบอร์ {grind.grind_value}</option>)}</select></div>
          {catalogError&&<div className="notice error" role="alert">{catalogError}<button className="button secondary" onClick={()=>void reloadCatalog()}>โหลดใหม่</button></div>}
          <div className="field"><label htmlFor="grinder">คนบด</label><select id="grinder" className="select" disabled={busy} value={grinderId} onChange={event=>setGrinderId(event.target.value)}><option value="">เลือกคนบด</option>{grinders.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        </>}
      </> : <p>สแกนหรือเลือกงานจากคิว</p>}</div>
      <div className="detail-actions">
        {error&&<div role="alert" className="notice error">{error}</div>}
        {action&&<button data-testid="job-action" className="button large" disabled={busy} onClick={()=>void transition()}>{busy?"กำลังบันทึก...":action.label}</button>}
        <small>รอรับ {queuedCount} ถุง · เสียงซ้ำจนรับงานครบ</small>
      </div>
    </aside>
  </main></div>;
}
