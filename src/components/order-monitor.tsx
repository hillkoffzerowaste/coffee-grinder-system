"use client";
import {useEffect,useRef,useState} from "react";
import {apiFetch} from "@/lib/api";
import {jobStatusLabels} from "@/lib/job-status";
import {orderSla} from "@/lib/order-sla";
import type {JobStatus} from "@/lib/types";
type Summary={id:string;order_no:string;created_at:string;total_bags:number;total_grams:number;grinding_started_at:string|null;completed_at:string|null;status:string;queued_count:number;active_count:number;completed_count:number;oldest_queued_at:string|null;overdue_queued_count:number;progress?:Partial<Record<JobStatus,number>>};
type Bag={id:string;bag_no:number;status:JobStatus;product_name_snapshot:string;size_grams_snapshot:number;grind_value_snapshot:string;grinder_name_snapshot:string|null;events:{status:JobStatus;at:string}[]};
function waitMinutes(oldestQueuedAt:string|null){const time=Date.parse(oldestQueuedAt??"");return Number.isFinite(time)?Math.max(0,Math.floor((Date.now()-time)/60000)):0;}
function statusClass(status:string){return status==="COMPLETED"?"ok":status==="QUEUED"?"warn":["CLAIMED","GRINDING"].includes(status)?"info":"";}
function duration(seconds:number){return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;}
export function OrderMonitor({revision}:{revision:number}){
 const [orders,setOrders]=useState<Summary[]>([]),[selected,setSelected]=useState("");
 const [view,setView]=useState<"active"|"history">("active"),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false),[loaded,setLoaded]=useState(false);
 const [bags,setBags]=useState<Bag[]>([]),[error,setError]=useState(""),[updated,setUpdated]=useState("");
 const [overdueNotice,setOverdueNotice]=useState<Summary|null>(null);
 const [detailLoaded,setDetailLoaded]=useState(false);
 const generation=useRef(0),notifiedOrderIds=useRef(new Set<string>());
 useEffect(()=>{
  const current=++generation.current;let active=true,busy=false;
  async function update(){
   if(busy)return;busy=true;
   try{
    const result=await apiFetch<{orders:Summary[];hasMore?:boolean}>(view==="active"&&page===0?"/api/orders":`/api/orders?view=${view}&page=${page}`);
    if(!active||current!==generation.current)return;
    const visible=result.orders.filter(order=>view==="active"?order.status==="OPEN":order.status!=="OPEN");
    setOrders(visible);setHasMore(!!result.hasMore);setLoaded(true);setError("");setUpdated(new Date().toLocaleTimeString("th-TH"));
    const overdue=visible.find(order=>order.overdue_queued_count>0&&!notifiedOrderIds.current.has(order.id));
    if(overdue){notifiedOrderIds.current.add(overdue.id);setOverdueNotice(overdue);}
    if(selected&&!visible.some(order=>order.id===selected)){setSelected("");setBags([]);setDetailLoaded(false);return;}
    if(selected){
     const detail=await apiFetch<{bags:Bag[]}>(`/api/orders/${selected}`);
     if(active&&current===generation.current){setBags(detail.bags);setDetailLoaded(true);}
    }
   }catch{if(active)setError("ขาดการเชื่อมต่อ — สถานะอาจยังไม่ล่าสุด กำลังลองใหม่");}
   finally{busy=false;}
  }
  void update();const timer=setInterval(()=>void update(),2000);
  const refresh=()=>{if(document.visibilityState==="visible")void update();};
  window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
  return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
 },[selected,revision,view,page]);
 function changeView(next:"active"|"history",nextPage=0){setView(next);setPage(nextPage);setOrders([]);setSelected("");setBags([]);setDetailLoaded(false);setLoaded(false);setHasMore(false);setError("");setUpdated("");}
 return <aside className="panel order-monitor"><h2>ติดตามงานบด–แพ็ค</h2>
  <div className="monitor-tabs" aria-label="มุมมองออเดอร์"><button type="button" className="button secondary" aria-pressed={view==="active"} onClick={()=>changeView("active")}>งานค้าง</button><button type="button" className="button secondary" aria-pressed={view==="history"} onClick={()=>changeView("history")}>ประวัติ</button></div>
  <small>อัปเดตอัตโนมัติทุก 2 วินาที · ล่าสุด {updated||"กำลังโหลด"}</small>
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="monitor-list">{orders.map(order=>{const sla=orderSla({totalGrams:order.total_grams,queuedAt:order.created_at,finishedAt:order.status==="COMPLETED"?order.completed_at:null});return <section className={`notice ${order.status==="COMPLETED"?"order-done":order.overdue_queued_count>0?"order-overdue":sla?.tone==="danger"?"order-sla-overdue":order.queued_count>0?"order-waiting":order.status==="OPEN"?"order-active":""}`} key={order.id}>
   <button className="button secondary" type="button" aria-expanded={selected===order.id} onClick={()=>{setBags([]);setDetailLoaded(false);setSelected(selected===order.id?"":order.id);}}>{order.order_no} · {order.total_bags} ถุง</button>
   {order.status!=="OPEN"&&<div><span className={`status ${statusClass(order.status)}`}>{order.status==="COMPLETED"?"เสร็จสิ้น":"ยกเลิก"}</span></div>}
   <div className="queue-summary" aria-label={`สรุปคิว ${order.order_no}`}><strong>รอรับ {order.queued_count} ถุง</strong><span>กำลังทำ {order.active_count} ถุง</span><span>เสร็จ {order.completed_count} ถุง</span><span>ค้างนานสุด {waitMinutes(order.oldest_queued_at)} นาที</span></div>
   {order.overdue_queued_count>0&&<div className="notice error overdue-queue-warning" role="alert">มี {order.overdue_queued_count} ถุงรอรับเกิน 1 นาที — โปรดรับงานทันที</div>}
   {sla&&<div className={`sla-summary ${sla.tone}`}><strong>SLA {duration(sla.elapsedSeconds)} / {duration(sla.targetSeconds)}</strong><span>{sla.tone==="danger"?"เกิน SLA":sla.tone==="warn"?"ใกล้ถึง SLA":"อยู่ใน SLA"}</span></div>}
   <div className="row" aria-label={`สถานะ ${order.order_no}`}>{Object.entries(order.progress??{}).map(([status,count])=><span className={`status ${statusClass(status)}`} key={status}>{jobStatusLabels[status as JobStatus]||status} {count}</span>)}</div>
   {selected===order.id&&<div className="stack">{!bags.length&&<small>{detailLoaded?"ไม่มีรายละเอียดถุง":"กำลังโหลดรายละเอียด..."}</small>}{bags.map(bag=><div className="notice" key={bag.id}>
    <strong className={`status ${statusClass(bag.status)}`}>ถุง {bag.bag_no} · {jobStatusLabels[bag.status]}</strong>
    <div>{bag.product_name_snapshot}</div><div>{bag.size_grams_snapshot} g · เบอร์ {bag.grind_value_snapshot} · คนบด {bag.grinder_name_snapshot||"ยังไม่เริ่ม"}</div>
    <details><summary>ประวัติสถานะ</summary>{bag.events.map((event,index)=><div key={index}>{jobStatusLabels[event.status]} · {new Date(event.at).toLocaleTimeString("th-TH")}</div>)}</details>
   </div>)}</div>}
  </section>})}</div>{!orders.length&&<p>{!loaded?"กำลังโหลดออเดอร์...":view==="active"?"ไม่มีงานค้างในหน้านี้":"ไม่มีประวัติในหน้านี้"}</p>}
  {(page>0||hasMore)&&<div className="row"><button type="button" className="button secondary" disabled={page===0} onClick={()=>changeView(view,page-1)}>ก่อนหน้า</button><span>หน้า {page+1}</span><button type="button" className="button secondary" disabled={!hasMore} onClick={()=>changeView(view,page+1)}>ถัดไป</button></div>}
  {overdueNotice&&<section className="overdue-order-dialog" role="alertdialog" aria-modal="true" aria-label="แจ้งเตือนงานรอรับ"><h3>ยังไม่มีคนรับงานเกิน 1 นาที</h3><p><strong>{overdueNotice.order_no}</strong> · รอรับ {overdueNotice.queued_count} ถุง · ค้างนานสุด {waitMinutes(overdueNotice.oldest_queued_at)} นาที</p><button type="button" className="button large" onClick={()=>setOverdueNotice(null)}>รับทราบ</button></section>}
 </aside>;
}
