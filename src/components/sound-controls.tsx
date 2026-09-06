"use client";
import type {useSounds} from "@/lib/use-sounds";
export function SoundControls({sound,onReady}:{sound:ReturnType<typeof useSounds>;onReady?:()=>void}){
  if(sound.enabled)return <small className="sound-active" role="status">เสียงแจ้งเตือนเปิดอยู่ตลอดการใช้งาน · ระดับ 100%</small>;
  return <dialog open className="sound-gate" aria-labelledby="sound-gate-title">
    <div className="panel stack"><h2 id="sound-gate-title">เปิดเสียงเพื่อเริ่มงาน</h2><p>ระบบต้องเปิดเสียงแจ้งเตือนตลอดการใช้งาน</p>
      <button autoFocus type="button" className="button large" onClick={()=>void sound.enable().then(ok=>{if(ok)onReady?.();})}>เปิดเสียงเพื่อเริ่มงาน</button>
      {sound.soundError&&<div className="notice error" role="alert">{sound.soundError}</div>}
    </div>
  </dialog>;
}
