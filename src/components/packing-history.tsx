"use client";
import {useEffect,useRef,useState} from "react";
import {apiFetch} from "@/lib/api";
import {OrderMonitor} from "@/components/order-monitor";

type Daily={day:string;bags:number;grams:number;orders:number;by_grinder:{name:string;bags:number}[]};
// วันของห้องแพ็คคือวันตามเวลาไทย ไม่ใช่วันตามเครื่องผู้ใช้หรือ UTC
const bangkokToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok"}).format(new Date());

export function PackingHistory({revision}:{revision:number}){
 const [day,setDay]=useState(bangkokToday);
 const [search,setSearch]=useState(""),[query,setQuery]=useState("");
 const [daily,setDaily]=useState<Daily|null>(null),[error,setError]=useState("");

 const debounce=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(debounce.current)clearTimeout(debounce.current);},[]);
 function onSearch(value:string){
  setSearch(value);
  if(debounce.current)clearTimeout(debounce.current);
  debounce.current=setTimeout(()=>setQuery(value.trim()),400);
 }

 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    const result=await apiFetch<{daily:Daily}>(`/api/jobs/daily?day=${day}`);
    if(active){setDaily(result.daily);setError("");}
   }catch(e){if(active){setDaily(null);setError(e instanceof Error?e.message:"โหลดสรุปของวันไม่สำเร็จ");}}
  }
  void load();
  return()=>{active=false;};
 },[day,revision]);

 return <div className="packing-history">
  <div className="row history-controls">
   <label htmlFor="history-day">วันที่</label>
   <input id="history-day" type="date" className="input" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}} />
   <button type="button" className="button secondary" disabled={day===bangkokToday()} onClick={()=>setDay(bangkokToday())}>วันนี้</button>
  </div>
  <div className="field">
   <label htmlFor="history-search">ค้นหา</label>
   <input id="history-search" className="input" autoComplete="off" placeholder="เลขออเดอร์ / ชื่อสินค้า / SKU / ชื่อคนบด"
    value={search} maxLength={100} onChange={e=>onSearch(e.target.value)} />
  </div>
  {error&&<div className="notice error" role="alert">{error}</div>}
  {daily&&<div className="queue-summary" aria-label="สรุปของวัน"><strong>เสร็จ {daily.bags} ถุง</strong><span>{daily.orders} ออเดอร์</span><span>{(daily.grams/1000).toFixed(1)} กก.</span></div>}
  {daily&&daily.by_grinder.length>0&&<div className="row" aria-label="แยกตามคนบด">{daily.by_grinder.map(g=><span className="status" key={g.name}>{g.name} {g.bags} ถุง</span>)}</div>}
  <OrderMonitor key={`${day}|${query}`} revision={revision} defaultView="history" day={day} query={query} embedded alerts={false} />
 </div>;
}
