"use client";
import {CounterWorkspace} from "@/components/counter-workspace";
import {JobSearch} from "@/components/product-search";
import {useEffect,useRef,useState} from "react";
import {Topbar} from "@/components/topbar";
import {GrindBarcodes} from "@/components/grind-barcodes";
import {QuantityDialog} from "@/components/quantity-dialog";
import {SoundControls} from "@/components/sound-controls";
import {useSounds} from "@/lib/use-sounds";
import {useQueueAlarm} from "@/lib/use-queue-alarm";
import {useCatalog} from "@/lib/use-catalog";
import {apiFetch,ApiError} from "@/lib/api";
import {useScannerFocus,useScannerInput} from "@/lib/scanner";
import {batchStartSchema,batchCompleteSchema} from "@/lib/validation";
import {jobStatusLabels} from "@/lib/job-status";
import type {BagJob,GrindLookup,Profile} from "@/lib/types";
import type {UiConfig} from "@/lib/ui-config";

type Queue={jobs:BagJob[];queuedCount:number;hasMore?:boolean};
type Pending={path:"/api/jobs/start"|"/api/jobs/complete";body:string;description:string};
type BatchResult={batch:{batch_id:string;bag_ids:string[]}};
const groupKey=(job:BagJob)=>`${job.order_id}:${job.product_barcode_snapshot}`;
const orderNo=(job:BagJob)=>job.orders?.order_no??job.order?.order_no??job.order_id;

export function PackingWorkspace({profile,initialManual=false,uiConfig}:{profile:Profile;initialManual?:boolean;uiConfig?:UiConfig}){
 const [manualOpen,setManualOpen]=useState(initialManual);
 const [jobs,setJobs]=useState<BagJob[]>([]),[queuedCount,setQueuedCount]=useState(0),[hasMore,setHasMore]=useState(false);
 const [context,setContext]=useState<BagJob|null>(null),[orderJobs,setOrderJobs]=useState<BagJob[]>([]),[candidates,setCandidates]=useState<BagJob[]>([]);
 const [batchId,setBatchId]=useState(""),[batchJobs,setBatchJobs]=useState<BagJob[]>([]),[revision,setRevision]=useState(0);
 const [scan,setScan]=useState(""),[grind,setGrind]=useState<GrindLookup|null>(null),[grinderId,setGrinderId]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[lastSync,setLastSync]=useState("");
 const [pending,setPending]=useState<Pending|null>(null),[recoveryError,setRecoveryError]=useState(false);
 const pendingRef=useRef<Pending|null>(null),operation=useRef(false),scanRef=useRef<HTMLInputElement>(null),ready=useRef(false);
 const queueRef=useRef<HTMLElement>(null);
 const {grinds,grinders,catalogError,reloadCatalog}=useCatalog(),sound=useSounds();
 useScannerInput(scanRef,setScan,!manualOpen);
 useScannerFocus(scanRef,manualOpen||busy||!!grind||!!pending||recoveryError);
 useQueueAlarm(queuedCount>0,sound.enabled,sound.play);
 const storageKey=`coffee-packing-pending:${profile.id}`;
 const canStart=(job:BagJob)=>job.status==="QUEUED"||(job.status==="CLAIMED"&&(job.claimed_by===profile.id||profile.role==="admin"));
 const available=orderJobs.filter(job=>context&&groupKey(job)===groupKey(context)&&canStart(job)&&job.grind_id===grind?.id);
 const refocus=()=>setTimeout(()=>{if(!document.querySelector("dialog[open]"))scanRef.current?.focus({preventScroll:true});},0);
 useEffect(()=>{
  let active=true;
  void Promise.resolve().then(()=>{
   if(!active)return;
   try{
    const raw=sessionStorage.getItem(storageKey);
    if(raw){const saved=JSON.parse(raw) as Pending;
     if(saved.path!=="/api/jobs/start"&&saved.path!=="/api/jobs/complete")throw new Error("Invalid recovery");
     (saved.path==="/api/jobs/start"?batchStartSchema:batchCompleteSchema).parse(JSON.parse(saved.body));
     pendingRef.current=saved;setPending(saved);setError("มีรายการรอยืนยันผล กรุณายืนยันซ้ำด้วยข้อมูลเดิม");
    }
    const selectedBatch=new URLSearchParams(window.location.search).get("batch");
    if(selectedBatch&&/^[a-f0-9-]{36}$/i.test(selectedBatch))setBatchId(selectedBatch);
   }catch{setRecoveryError(true);setError("อ่านรายการค้างไม่ได้ กรุณาให้ผู้ดูแลตรวจสอบก่อนทำรายการใหม่");}
   ready.current=true;
  });return()=>{active=false;};
 },[storageKey]);
 useEffect(()=>{
  let active=true,inFlight=false;
  async function load(){if(inFlight)return;inFlight=true;
   try{
    const [queue,detail,batch]=await Promise.all([apiFetch<Queue>("/api/jobs"),context?apiFetch<Queue>(`/api/jobs?orderId=${context.order_id}`):null,batchId?apiFetch<Queue>(`/api/jobs?batch=${batchId}`):null]);
    if(!active)return;
    setJobs(queue.jobs);setQueuedCount(queue.queuedCount??queue.jobs.filter(j=>j.status==="QUEUED").length);setHasMore(!!queue.hasMore);setLastSync(new Date().toLocaleTimeString("th-TH"));
    if(detail){setOrderJobs(detail.jobs);if(context?.status==="GRINDING"&&!detail.jobs.some(j=>j.id===context.id)){setContext(null);setMessage("รายการเดิมไม่อยู่ในคิวงานล่าสุดแล้ว");}}
    if(batch){setBatchJobs(batch.jobs);if(!batch.jobs.length){setBatchId("");setMessage("ชุดงานนี้ไม่มีถุงที่กำลังทำแล้ว — ดูผลในประวัติ");}}
    setError(current=>current==="โหลดสถานะไม่สำเร็จ — กำลังลองใหม่"?"":current);
   }catch{if(active)setError("โหลดสถานะไม่สำเร็จ — กำลังลองใหม่");}finally{inFlight=false;}
  }
  void load();const timer=setInterval(()=>void load(),5000);
  return()=>{active=false;clearInterval(timer);};
 },[context,batchId,revision]);
 async function choose(job:BagJob){
  if(operation.current||pendingRef.current||recoveryError)return;
  setError("");setMessage("");setGrind(null);setCandidates([]);setBatchId("");setBatchJobs([]);setContext(null);setOrderJobs([]);
  if(job.status==="GRINDING"&&job.grinding_batch_id){setBatchId(job.grinding_batch_id);refocus();return;}
  operation.current=true;setBusy(true);
  try{const detail=await apiFetch<Queue>(`/api/jobs?orderId=${job.order_id}`);setOrderJobs(detail.jobs);setContext(job);queueRef.current?.scrollTo({top:0});}
  catch(e){setError(e instanceof Error?e.message:"โหลดงานไม่สำเร็จ");}
  finally{operation.current=false;setBusy(false);refocus();}
 }
 async function onScan(event:React.FormEvent){
  event.preventDefault();const value=(scanRef.current?.value??scan).trim();
  if(!value||!ready.current||operation.current||pendingRef.current||recoveryError||grind)return;
  if(!context&&!/^(?:\d+|[a-f0-9-]{36})$/i.test(value))return;
  operation.current=true;setBusy(true);setError("");setMessage("");let single:BagJob|undefined;
  try{
   if(context&&context.status!=="GRINDING"){
    const [result,latest]=await Promise.all([apiFetch<{grind:GrindLookup}>(`/api/catalog/grind/${encodeURIComponent(value)}`),apiFetch<Queue>(`/api/jobs?orderId=${context.order_id}`)]);
    setOrderJobs(latest.jobs);
    if(!latest.jobs.some(j=>groupKey(j)===groupKey(context)&&canStart(j)&&j.grind_id===result.grind.id))throw new Error("เบอร์บดไม่ตรงกับงานที่ยังรอรับของสินค้านี้");
    setGrind(result.grind);
   }else{
    const result=await apiFetch<Queue>(`/api/jobs?scan=${encodeURIComponent(value)}`);
    if(result.hasMore)throw new Error("พบงานจำนวนมาก กรุณาสแกนเลขคิวเพื่อระบุงานให้ชัดเจน");
    const matching=result.jobs.filter(j=>canStart(j)||j.status==="GRINDING");
    const queued=matching.filter(canStart);
    const selectable=queued.length?queued:matching.filter(j=>j.status==="GRINDING");
    if(!selectable.length)throw new Error("ไม่พบงานที่รับได้สำหรับบาร์โค้ดนี้");
    const groups=[...new Map(selectable.map(j=>[j.grinding_batch_id??(j.status==="GRINDING"?j.id:groupKey(j)),j])).values()];
    setContext(null);setBatchId("");setBatchJobs([]);setCandidates(groups);if(groups.length===1)single=groups[0];
   }
   setScan("");sound.play("success");
  }catch(e){setGrind(null);sound.play("error");setError(e instanceof Error?e.message:"สแกนไม่สำเร็จ");}
  finally{operation.current=false;setBusy(false);if(single)void choose(single);else refocus();}
 }
 async function execute(request:Pending){
  if(operation.current||recoveryError)return;
  const saved=pendingRef.current??request;operation.current=true;setBusy(true);setError("");
  try{
   sessionStorage.setItem(storageKey,JSON.stringify(saved));pendingRef.current=saved;setPending(saved);
   const result=await apiFetch<BatchResult>(saved.path,{method:"POST",body:saved.body});
   if(!batchCompleteSchema.safeParse({clientRequestId:JSON.parse(saved.body).clientRequestId,batchId:result.batch?.batch_id}).success||!Array.isArray(result.batch?.bag_ids))throw new ApiError("ผลตอบกลับไม่ครบ กรุณายืนยันซ้ำด้วยข้อมูลเดิม",502);
   sessionStorage.removeItem(storageKey);pendingRef.current=null;setPending(null);setGrind(null);setContext(null);setCandidates([]);setOrderJobs([]);
   if(saved.path==="/api/jobs/start"){setBatchId(result.batch.batch_id);setMessage("ยืนยันแล้ว — กำลังบด");}
   else{setBatchId("");setBatchJobs([]);setMessage("เสร็จสิ้น — จัดเก็บในประวัติแล้ว");}
   sound.play("success");setRevision(n=>n+1);
  }catch(e){
   const rejected=e instanceof ApiError&&[400,409,422].includes(e.status);
   if(rejected){sessionStorage.removeItem(storageKey);pendingRef.current=null;setPending(null);}
   setError(rejected?e.message:"ยังยืนยันผลไม่ได้ กรุณายืนยันซ้ำด้วยข้อมูลเดิม ห้ามเปิดรายการซ้ำ");sound.play("error");
  }finally{operation.current=false;setBusy(false);refocus();}
 }
 function start(quantity:number){
  if(pendingRef.current){void execute(pendingRef.current);return;}
  if(!context||!grind||!grinderId){setError("เลือกคนบดก่อนยืนยัน");return;}
  const body=JSON.stringify({clientRequestId:crypto.randomUUID(),orderId:context.order_id,productBarcode:context.product_barcode_snapshot,grindId:grind.id,quantity,grinderUserId:grinderId});
  if(!batchStartSchema.safeParse(JSON.parse(body)).success||quantity>available.length){setError("จำนวนเกินงานที่ยังรอรับ หรือข้อมูลไม่ถูกต้อง");return;}
  void execute({path:"/api/jobs/start",body,description:`${orderNo(context)} · ${context.product_name_snapshot} · เบอร์ ${grind.grind_value} · ${quantity} ถุง`});
 }
 async function selectManualGrind(id:string){
  if(!context||operation.current||pendingRef.current)return;
  const chosen=grinds.find(g=>g.id===id);if(!chosen)return;
  operation.current=true;setBusy(true);setError("");
  try{const latest=await apiFetch<Queue>(`/api/jobs?orderId=${context.order_id}`);setOrderJobs(latest.jobs);
   if(!latest.jobs.some(j=>groupKey(j)===groupKey(context)&&canStart(j)&&j.grind_id===id))throw new Error("ไม่มีถุงรอรับสำหรับเบอร์นี้แล้ว");
   setGrind({...chosen,barcode:null});
  }catch(e){setError(e instanceof Error?e.message:"เลือกเบอร์บดไม่สำเร็จ");}
  finally{operation.current=false;setBusy(false);refocus();}
 }
 function clearSelection(){if(operation.current||pendingRef.current)return;setContext(null);setCandidates([]);setBatchId("");setBatchJobs([]);setGrind(null);setScan("");setError("");refocus();}
 async function completeLegacy(){
  if(!context||context.status!=="GRINDING"||operation.current||pendingRef.current)return;
  operation.current=true;setBusy(true);setError("");
  try{await apiFetch(`/api/jobs/${context.id}/transition`,{method:"POST",body:JSON.stringify({expectedStatus:"GRINDING",nextStatus:"COMPLETED"})});setContext(null);setMessage("เสร็จสิ้นรายการเดิมแล้ว");}
  catch(e){setError(e instanceof Error?e.message:"ยืนยันผลไม่สำเร็จ กรุณาตรวจสถานะแล้วลองใหม่");}
  finally{setRevision(n=>n+1);operation.current=false;setBusy(false);refocus();}
 }
 const visibleRows=[...new Map(jobs.map(j=>[j.grinding_batch_id??j.id,j])).values()];
 const canCompleteBatch=batchJobs.length>0&&batchJobs.every(j=>j.status==="GRINDING"&&j.claimed_by===profile.id);
 if(manualOpen)return <div className="app-shell operational-shell" data-density={uiConfig?.theme.density} data-button-size={uiConfig?.theme.buttonSize}><Topbar title="ห้องแพ็ค · เปิดออเดอร์ด่วน" profile={profile} uiConfig={uiConfig}/><CounterWorkspace embedded profile={profile} source="PACKING_MANUAL" onCancel={()=>{setManualOpen(false);setScan("");refocus();}} onCompleted={id=>{setContext(null);setCandidates([]);setOrderJobs([]);setBatchJobs([]);setBatchId(id);setScan("");setMessage("เปิดออเดอร์แล้ว — กำลังบด");setRevision(n=>n+1);setManualOpen(false);refocus();}}/></div>;
 return <div className="app-shell operational-shell" data-density={uiConfig?.theme.density} data-button-size={uiConfig?.theme.buttonSize}><Topbar title="ห้องแพ็ค" profile={profile} uiConfig={uiConfig}/><main id="main" tabIndex={-1} className="workspace grid packing-layout">
  <section ref={queueRef} className="panel packing-queue"><SoundControls sound={sound} onReady={refocus}/>
   <div className="row"><h2>คิวงานบด</h2><button type="button" className="button secondary" disabled={busy||!!pending||!!grind||recoveryError} onClick={()=>setManualOpen(true)}>เปิดออเดอร์เอง</button><button className="button secondary" disabled={busy||!!pending} onClick={clearSelection}>สแกนสินค้าใหม่</button></div>
   {context&&<div className="product-result"><div><strong className="product-name">{context.product_name_snapshot}</strong><div>{context.sku_snapshot} · {orderNo(context)}</div></div><strong>{context.size_grams_snapshot} g</strong></div>}
   <form className="field" onSubmit={onScan}><label htmlFor="packing-scan">{context&&context.status!=="GRINDING"?"ตรวจชื่อสินค้าแล้ว สแกนหรือคลิกเบอร์บด":"สแกน Product Barcode / เลขคิว หรือพิมพ์ชื่อ / SKU"}</label><input ref={scanRef} id="packing-scan" className="input scan-input" autoFocus autoComplete="off" value={scan} onChange={e=>setScan(e.target.value)} disabled={busy||!!pending||!!grind||recoveryError}/></form>
   {!context&&<JobSearch query={scan} disabled={busy||!!pending||recoveryError} profileId={profile.id} isAdmin={profile.role==="admin"} onSelect={job=>{setScan("");void choose(job);}}/>}
   <section className="barcode-drawer"><GrindBarcodes grinds={grinds} error={catalogError} retry={reloadCatalog} disabled={!context||context.status==="GRINDING"||busy||!!pending||!!grind||recoveryError} onSelect={g=>void selectManualGrind(g.id)}/></section>
   {hasMore&&<div className="notice">แสดง 1,000 ถุงแรก — สแกนบาร์โค้ดหรือเลขคิวเพื่อค้นหางานที่เหลือ</div>}
   <div className="data-table-wrap"><table className="data-table"><thead><tr><th>คิว</th><th>สินค้า / ออเดอร์</th><th>ขนาด</th><th>เบอร์บด</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{visibleRows.map(j=><tr key={j.grinding_batch_id??j.id}><td>#{j.queue_seq}</td><td>{j.product_name_snapshot}<br/><small>{j.sku_snapshot} · {orderNo(j)}</small></td><td>{j.size_grams_snapshot} g</td><td>{j.grind_value_snapshot}</td><td><span className={`status ${j.status==="QUEUED"?"warn":"info"}`}>{jobStatusLabels[j.status]}</span>{j.grinding_batch_id&&<small> · ชุดงาน</small>}</td><td><button className="button secondary" disabled={busy||!!pending||recoveryError} onClick={()=>void choose(j)}>เปิดงาน</button></td></tr>)}</tbody></table>{!jobs.length&&<div className="empty">ไม่มีงานในคิวนี้</div>}</div>
   <small>อัปเดตล่าสุด {lastSync||"กำลังเชื่อมต่อ..."} · โหลดข้อมูลซ้ำทุก 5 วินาที</small>
  </section>
  <aside className="panel packing-detail"><h2>{batchId?"กำลังบด":"งานที่เลือก"}</h2><div className="detail-content">
   {candidates.length>1&&<><div className="notice">สินค้านี้มีหลายงาน กรุณาเลือกออเดอร์ก่อนสแกนเบอร์บด</div>{candidates.map(j=><button key={j.grinding_batch_id??(j.status==="GRINDING"?j.id:groupKey(j))} className="button secondary" disabled={busy||!!pending} onClick={()=>void choose(j)}>{orderNo(j)} · คิว #{j.queue_seq} · {j.product_name_snapshot} · {jobStatusLabels[j.status]}</button>)}</>}
   {context&&<><strong>{orderNo(context)}</strong><div className="product-name">{context.product_name_snapshot}</div><div>{context.sku_snapshot} · {context.size_grams_snapshot} g</div><div className="notice">สแกนเบอร์บด จากนั้นระบุจำนวนถุงเพื่อเข้าสถานะกำลังบด</div><div>เบอร์ที่รอรับ: {[...new Set(orderJobs.filter(j=>groupKey(j)===groupKey(context)&&canStart(j)).map(j=>j.grind_value_snapshot))].join(", ")||"ไม่มี"}</div></>}
   {context&&context.status!=="GRINDING"&&<div className="field"><label htmlFor="packing-grind-select">เลือกเบอร์บดเอง (กรณีไม่มีบาร์โค้ด)</label><select id="packing-grind-select" className="select" value="" disabled={busy||!!pending} onChange={e=>void selectManualGrind(e.target.value)}><option value="">เลือกเบอร์บด</option>{grinds.filter(g=>orderJobs.some(j=>groupKey(j)===groupKey(context)&&canStart(j)&&j.grind_id===g.id)).map(g=><option value={g.id} key={g.id}>เบอร์ {g.grind_value}</option>)}</select></div>}
   {batchId&&<><strong>{batchJobs[0]?orderNo(batchJobs[0]):"กำลังโหลดชุดงาน..."} · {batchJobs.length} ถุง</strong>{batchJobs.map(j=><div className="notice" key={j.id}>{j.product_name_snapshot}<br/>{j.size_grams_snapshot} g · เบอร์ {j.grind_value_snapshot} · {j.grinder_name_snapshot}</div>)}</>}
   {!context&&!batchId&&!candidates.length&&<p>สแกนถุงเพื่อดึงงาน ตรวจชื่อสินค้า แล้วสแกนเบอร์บด</p>}
  </div><div className="detail-actions">
   {error&&<div className="notice error" role="alert">{error}</div>}{message&&<div className="notice success" role="status">{message}</div>}
   {pending&&!grind&&<div className="notice"><div>{pending.description}</div><button className="button" disabled={busy} onClick={()=>void execute(pending)}>ยืนยันรายการค้างด้วยข้อมูลเดิม</button></div>}
   {context?.status==="GRINDING"&&!context.grinding_batch_id&&<button className="button large" disabled={busy||!!pending} onClick={()=>void completeLegacy()}>เสร็จสิ้นรายการเดิม</button>}
   {batchId&&<button data-testid="job-action" className="button large" disabled={busy||!!pending||!canCompleteBatch} onClick={()=>void execute({path:"/api/jobs/complete",body:JSON.stringify({clientRequestId:crypto.randomUUID(),batchId}),description:`เสร็จสิ้นชุดงาน ${batchJobs.length} ถุง`})}>เสร็จสิ้น {batchJobs.length} ถุง</button>}
   {batchJobs.length>0&&!canCompleteBatch&&<small>ผู้รับงานชุดนี้ต้องเป็นผู้ยืนยันเสร็จสิ้น</small>}
   <small>รอรับ {queuedCount} ถุง · เสียงเตือนระดับ 100% ดังซ้ำทุก 3 วินาทีจนงานรอรับเหลือ 0 ถุง</small>
  </div></aside>
  {grind&&context&&<QuantityDialog title="ยืนยันจำนวนเพื่อเริ่มบด" description={`${orderNo(context)} · ${context.product_name_snapshot} · ${context.size_grams_snapshot} g · เบอร์ ${grind.grind_value}`} max={pending?99:Math.min(99,available.length)} locked={!!pending} busy={busy} error={error} onConfirm={start} onCancel={()=>{if(pendingRef.current){setError("ต้องยืนยันรายการค้างก่อน");return;}setGrind(null);setError("");refocus();}}>
   <div className="field"><label htmlFor="grinder">คนบด</label><select id="grinder" className="select" required disabled={busy||!!pending} value={grinderId} onChange={e=>setGrinderId(e.target.value)}><option value="">เลือกคนบด</option>{grinders.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
   {pending&&<div className="notice">ยืนยันซ้ำด้วยจำนวนและคนบดเดิมเท่านั้น: {pending.description}</div>}
  </QuantityDialog>}
 </main></div>;
}
