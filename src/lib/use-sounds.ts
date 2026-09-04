"use client";
import {useCallback,useEffect,useRef,useState} from "react";
export type SoundKind="success"|"error"|"newJob";
export const soundNotes:Record<SoundKind,number[]>={success:[880],error:[220,220],newJob:[660,880,1100]};
export function useSounds(){
  const audio=useRef<AudioContext|null>(null),allowed=useRef(false);
  const [enabled,setEnabled]=useState(false),[soundError,setError]=useState("");
  const play=useCallback((kind:SoundKind)=>{
    const context=audio.current;
    if(!allowed.current||!context)return;
    if(context.state!=="running"){allowed.current=false;setEnabled(false);setError("เสียงถูกพัก กรุณากดเปิดเสียงอีกครั้ง");return;}
    try {
      soundNotes[kind].forEach((frequency,index)=>{
        const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*.18;
        oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(1,start+.01);gain.gain.linearRampToValueAtTime(0,start+.12);
        oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.13);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      });
    }catch{allowed.current=false;setEnabled(false);setError("เล่นเสียงไม่ได้ กรุณาตรวจลำโพงและกดเปิดเสียงอีกครั้ง");}
  },[]);
  const enable=useCallback(async()=>{
    try {
      if(!window.AudioContext)throw new Error("Audio unavailable");
      const context=audio.current??new window.AudioContext();audio.current=context;
      await context.resume();
      if(audio.current!==context||context.state!=="running")return;
      allowed.current=true;setEnabled(true);setError("");play("success");
    }catch{setError("เปิดเสียงไม่ได้ กรุณาตรวจการอนุญาตเสียงของเบราว์เซอร์");}
  },[play]);
  const mute=useCallback(()=>{allowed.current=false;setEnabled(false);void audio.current?.suspend().catch(()=>undefined);},[]);
  useEffect(()=>()=>{allowed.current=false;const context=audio.current;audio.current=null;void context?.close().catch(()=>undefined);},[]);
  return {enabled,soundError,play,enable,mute};
}
