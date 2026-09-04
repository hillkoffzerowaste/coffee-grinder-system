"use client";

import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api";
import type {ProductLookup,BagJob} from "@/lib/types";

function useSearch<T>(query:string,url:string,disabled:boolean){
 const term=query.trim();
 const eligible=!disabled&&term.length>=2&&term.length<=100&&!/^\d+$/.test(term);
 const [result,setResult]=useState<{key:string;data?:T;error?:string}|null>(null);
 useEffect(()=>{
  if(!eligible)return;
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{
   void apiFetch<T>(url+encodeURIComponent(term),{signal:controller.signal})
    .then(data=>{if(active)setResult({key:term,data});})
    .catch(error=>{if(active)setResult({key:term,error:error instanceof Error?error.message:"ค้นหาไม่สำเร็จ"});});
  },300);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[term,url,eligible]);
 return {eligible,result:result?.key===term?result:null};
}

export function ProductSearch({query,disabled=false,onSelect}:{query:string;disabled?:boolean;onSelect:(product:ProductLookup)=>void}){
 const {eligible,result}=useSearch<{products:ProductLookup[]}>(query,"/api/catalog/search?q=",disabled);
 if(!eligible)return null;
 return <section aria-label="ผลค้นหาสินค้า" className="stack" style={{maxHeight:240,overflowY:"auto",flexShrink:0}}>
  {!result&&<small role="status">กำลังค้นหาสินค้า…</small>}
  {result?.error&&<div role="alert" className="notice error">{result.error}</div>}
  {result?.data?.products.map(product=><button type="button" className="button secondary" style={{textAlign:"left",whiteSpace:"normal"}} key={`${product.id}:${product.barcode}`} onClick={()=>{if(!disabled)onSelect(product);}}><strong>{product.name}</strong><br/>{product.sku} · {product.size_grams} g · {product.barcode}</button>)}
  {result?.data&&!result.data.products.length&&<small role="status">ไม่พบสินค้า ลองชื่อหรือ SKU อื่น</small>}
 </section>;
}

export function JobSearch({query,disabled=false,profileId,isAdmin,onSelect}:{query:string;disabled?:boolean;profileId:string;isAdmin:boolean;onSelect:(job:BagJob)=>void}){
 const {eligible,result}=useSearch<{jobs:BagJob[];hasMore?:boolean}>(query,"/api/jobs?search=",disabled);
 if(!eligible)return null;
 const jobs=[...new Map((result?.data?.jobs??[]).filter(j=>j.status==="QUEUED"||(j.status==="CLAIMED"&&(isAdmin||j.claimed_by===profileId))).map(j=>[`${j.order_id}:${j.product_barcode_snapshot}`,j])).values()];
 return <section aria-label="ผลค้นหางานค้าง" className="stack" style={{maxHeight:240,overflowY:"auto",flexShrink:0}}>
  {!result&&<small role="status">กำลังค้นหางานค้าง…</small>}
  {result?.error&&<div role="alert" className="notice error">{result.error}</div>}
  {jobs.map(job=><button type="button" className="button secondary" style={{textAlign:"left",whiteSpace:"normal"}} key={`${job.order_id}:${job.product_barcode_snapshot}`} onClick={()=>{if(!disabled)onSelect(job);}}><strong>{job.product_name_snapshot}</strong><br/>{job.sku_snapshot} · {job.size_grams_snapshot} g · {job.orders?.order_no??job.order_id} · คิว #{job.queue_seq}</button>)}
  {result?.data&&!jobs.length&&<small role="status">ไม่พบงานที่ยังรอรับสำหรับคำค้นนี้</small>}
  {result?.data?.hasMore&&<small>มีผลเพิ่มเติม กรุณาระบุชื่อหรือเลขออเดอร์ให้เจาะจงขึ้น</small>}
 </section>;
}
