"use client";
import { barcodeBits } from "@/lib/barcode";
import type { GrindLookup } from "@/lib/types";
const primary=["6","8","10","12","15"];
export function GrindBarcodes({grinds,error,retry}:{grinds:GrindLookup[];error:string;retry:()=>Promise<void>}) {
  const items=primary.flatMap(value=>grinds.filter((g):g is GrindLookup & {barcode:string}=>g.grind_value===value&&!!g.barcode));
  return <section className="stack" aria-label="บาร์โค้ดเบอร์บด">
    <h3>บาร์โค้ดเบอร์บด — สแกนจากจอ</h3>
    <small>สแกนสินค้าก่อนเลือกเบอร์บด · เครื่องสแกนต้องรองรับการอ่านจากจอ</small>
    {error && <div className="notice error" role="alert">{error} <button type="button" className="button secondary" onClick={()=>void retry()}>โหลดเบอร์บดใหม่</button></div>}
    <div className="grind-barcode-grid">{items.map(grind=>{
      const bits=barcodeBits(grind.barcode),width=(bits.length+20)*2;
      return <figure className="panel stack" key={grind.id} style={{margin:0,maxWidth:"100%",minWidth:0}}>
        <strong>เบอร์ {grind.grind_value}</strong>
        <svg role="img" aria-label={`บาร์โค้ดเบอร์บด ${grind.grind_value}: ${grind.barcode}`} data-barcode={grind.barcode} width={width} height={88} viewBox={`0 0 ${width} 88`} style={{maxWidth:"100%",height:"auto"}} shapeRendering="crispEdges">
          <rect width={width} height={88} fill="var(--surface)" />
          {Array.from(bits,(bit,i)=>bit==="1"?<rect key={i} x={20+i*2} y={8} width={2} height={72} fill="var(--text)" />:null)}
        </svg>
        <figcaption>{grind.barcode}</figcaption>
      </figure>;
    })}</div>
    {!items.length && !error && <p role="status">ยังไม่มีบาร์โค้ดเบอร์หลักที่เปิดใช้งาน หรือกำลังโหลดข้อมูล</p>}
  </section>;
}
