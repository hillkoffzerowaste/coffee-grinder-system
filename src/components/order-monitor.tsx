"use client";
import {useEffect,useRef,useState} from "react";
import {apiFetch} from "@/lib/api";
import {jobStatusLabels} from "@/lib/job-status";
import type {JobStatus} from "@/lib/types";
type Summary={id:string;order_no:string;total_bags:number;status:string;progress?:Partial<Record<JobStatus,number>>};
type Bag={id:string;bag_no:number;status:JobStatus;product_name_snapshot:string;size_grams_snapshot:number;grind_value_snapshot:string;grinder_name_snapshot:string|null;events:{status:JobStatus;at:string}[]};
export function OrderMonitor({revision}:{revision:number}){
 const [orders,setOrders]=useState<Summary[]>([]),[selected,setSelected]=useState("");
 const [bags,setBags]=useState<Bag[]>([]),[error,setError]=useState(""),[updated,setUpdated]=useState("");
 const generation=useRef(0);
 useEffect(()=>{
  const current=++generation.current;let active=true,busy=false;
  async function update(){
   if(busy)return;busy=true;
   try{
    const [result,detail]=await Promise.all([apiFetch<{orders:Summary[]}>("/api/orders"),selected?apiFetch<{bags:Bag[]}>(`/api/orders/${selected}`):Promise.resolve(null)]);
    if(active&&current===generation.current){setOrders(result.orders);setBags(detail?.bags??[]);setError("");setUpdated(new Date().toLocaleTimeString("th-TH"));}
   }catch{if(active)setError("ขาดการเชื่อมต่อ — สถานะอาจยังไม่ล่าสุด กำลังลองใหม่");}
   finally{busy=false;}
  }
  void update();const timer=setInterval(()=>void update(),2000);
  const refresh=()=>{if(document.visibilityState==="visible")void update();};
  window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
  return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
 },[selected,revision]);
 return <aside className="panel order-monitor"><h2>ติดตามงานบด–แพ็ค</h2>
  <small>อัปเดตอัตโนมัติทุก 2 วินาที · ล่าสุด {updated||"กำลังโหลด"}</small>
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="monitor-list">{orders.map(order=><section className="notice" key={order.id}>
   <button className="button secondary" type="button" aria-expanded={selected===order.id} onClick={()=>{setBags([]);setSelected(selected===order.id?"":order.id);}}>{order.order_no} · {order.total_bags} ถุง</button>
   <div className="row" aria-label={`สถานะ ${order.order_no}`}>{Object.entries(order.progress??{}).map(([status,count])=><span className="status" key={status}>{jobStatusLabels[status as JobStatus]||status} {count}</span>)}</div>
   {selected===order.id&&<div className="stack">{!bags.length&&<small>กำลังโหลดรายละเอียด...</small>}{bags.map(bag=><div className="notice" key={bag.id}>
    <strong>ถุง {bag.bag_no} · {jobStatusLabels[bag.status]}</strong>
    <div>{bag.product_name_snapshot}</div><div>{bag.size_grams_snapshot} g · เบอร์ {bag.grind_value_snapshot} · คนบด {bag.grinder_name_snapshot||"ยังไม่เริ่ม"}</div>
    <details><summary>ประวัติสถานะ</summary>{bag.events.map((event,index)=><div key={index}>{jobStatusLabels[event.status]} · {new Date(event.at).toLocaleTimeString("th-TH")}</div>)}</details>
   </div>)}</div>}
  </section>)}</div>{!orders.length&&<p>ยังไม่มีออเดอร์</p>}
 </aside>;
}
