"use client";
import type {useSounds} from "@/lib/use-sounds";
export function SoundControls({sound,onReady}:{sound:ReturnType<typeof useSounds>;onReady?:()=>void}){
  return <div className="stack">
    <div className="row"><button type="button" className="button secondary" onClick={()=>void sound.enable().then(()=>onReady?.())}>{sound.enabled?"ทดสอบเสียง":"เปิดเสียงแจ้งเตือน"}</button>
      {sound.enabled && <button type="button" className="button secondary" onClick={()=>{sound.mute();onReady?.();}}>ปิดเสียง</button>}
      <small role="status">{sound.enabled?"เสียงเปิดอยู่":"เสียงปิด — กดเปิดเสียงก่อนใช้งาน"}</small>
    </div>
    {sound.soundError && <div className="notice error" role="alert">{sound.soundError}</div>}
  </div>;
}
