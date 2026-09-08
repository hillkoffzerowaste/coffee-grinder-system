"use client";
import {useCallback,useState} from "react";
import {apiFetch} from "@/lib/api";

type Daily={day_start:string;bags:number;grams:number;orders:number;
 by_grinder:{name:string;bags:number}[];orders_list:{order_no:string;bags:number;finished_at:string}[]};
const clock=(at:string)=>new Date(at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});

export function DailyHistory(){
 const [daily,setDaily]=useState<Daily|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loadedAt,setLoadedAt]=useState("");
 const load=useCallback(async()=>{
  setBusy(true);setError("");
  try{const result=await apiFetch<{daily:Daily}>("/api/jobs/daily");setDaily(result.daily);setLoadedAt(new Date().toLocaleTimeString("th-TH"));}
  catch(e){setError(e instanceof Error?e.message:"โหลดประวัติวันนี้ไม่สำเร็จ");}
  finally{setBusy(false);}
 },[]);
 return <details className="daily-history" onToggle={e=>{if((e.currentTarget as HTMLDetailsElement).open&&!daily&&!busy)void load();}}>
  <summary>ประวัติวันนี้</summary>
  <div className="stack">
   <div className="row"><button type="button" className="button secondary" disabled={busy} onClick={()=>void load()}>{busy?"กำลังโหลด...":"โหลดใหม่"}</button>
    {loadedAt&&<small>ข้อมูล ณ {loadedAt}</small>}</div>
   {error&&<div className="notice error" role="alert">{error}</div>}
   {daily&&<>
    <div className="queue-summary"><strong>เสร็จวันนี้ {daily.bags} ถุง</strong><span>{daily.orders} ออเดอร์</span><span>{(daily.grams/1000).toFixed(1)} กก.</span></div>
    {!daily.bags&&<div className="empty">ยังไม่มีงานเสร็จวันนี้</div>}
    {daily.by_grinder.length>0&&<div className="row" aria-label="แยกตามคนบด">{daily.by_grinder.map(g=><span className="status" key={g.name}>{g.name} {g.bags} ถุง</span>)}</div>}
    {daily.orders_list.length>0&&<div className="data-table-wrap"><table className="data-table"><thead><tr><th>ออเดอร์</th><th>ถุง</th><th>เสร็จเมื่อ</th></tr></thead>
     <tbody>{daily.orders_list.map(o=><tr key={o.order_no}><td>{o.order_no}</td><td>{o.bags}</td><td>{clock(o.finished_at)}</td></tr>)}</tbody></table></div>}
   </>}
  </div>
 </details>;
}
