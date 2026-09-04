"use client";
import {useCallback,useEffect,useRef,useState} from "react";
export type SoundKind="success"|"error"|"newJob"|"pending"|"overdue";
type AlertSoundKind=Exclude<SoundKind,"success"|"error">;
export const soundNotes:Record<"success"|"error",number[]>={success:[880],error:[220,220]};
export const alertSoundFiles:Record<AlertSoundKind,{src:string;volume:number}>={
  newJob:{src:"/sounds/order-new.wav",volume:1},
  pending:{src:"/sounds/queue-reminder.wav",volume:.82},
  overdue:{src:"/sounds/sla-overdue.wav",volume:.92},
};
const isAlertSound=(kind:SoundKind):kind is AlertSoundKind=>kind in alertSoundFiles;
export function useSounds(){
  const audio=useRef<AudioContext|null>(null),clips=useRef<Partial<Record<AlertSoundKind,HTMLAudioElement>>>({}),allowed=useRef(false),alertRequest=useRef(0);
  const [enabled,setEnabled]=useState(false),[soundError,setError]=useState("");
  const play=useCallback((kind:SoundKind)=>{
    const context=audio.current;
    if(!allowed.current||!context)return;
    if(context.state!=="running"){allowed.current=false;setEnabled(false);setError("เสียงถูกพัก กรุณากดเปิดเสียงอีกครั้ง");return;}
    try {
      if(isAlertSound(kind)){
        const clip=clips.current[kind];
        if(!clip)throw new Error("Alert audio unavailable");
        const request=++alertRequest.current;
        Object.values(clips.current).forEach(item=>{if(item&&item!==clip){item.pause();item.currentTime=0;}});
        clip.pause();clip.currentTime=0;
        void clip.play().catch(()=>{if(allowed.current&&request===alertRequest.current){allowed.current=false;setEnabled(false);setError("เล่นเสียงไม่ได้ กรุณาตรวจลำโพงและกดเปิดเสียงอีกครั้ง");}});
        return;
      }
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
      allowed.current=true;setEnabled(true);setError("");play("newJob");
    }catch{setError("เปิดเสียงไม่ได้ กรุณาตรวจการอนุญาตเสียงของเบราว์เซอร์");}
  },[play]);
  const mute=useCallback(()=>{allowed.current=false;alertRequest.current++;setEnabled(false);Object.values(clips.current).forEach(clip=>{clip?.pause();if(clip)clip.currentTime=0;});void audio.current?.suspend().catch(()=>undefined);},[]);
  useEffect(()=>{
    const requestRef=alertRequest;
    const loaded:Partial<Record<AlertSoundKind,HTMLAudioElement>>={};
    (Object.entries(alertSoundFiles) as [AlertSoundKind,{src:string;volume:number}][]).forEach(([kind,config])=>{
      const clip=new window.Audio(config.src);clip.preload="auto";clip.volume=config.volume;loaded[kind]=clip;
    });
    clips.current=loaded;
    return()=>{allowed.current=false;requestRef.current++;Object.values(loaded).forEach(clip=>{clip?.pause();if(clip)clip.currentTime=0;});clips.current={};const context=audio.current;audio.current=null;void context?.close().catch(()=>undefined);};
  },[]);
  return {enabled,soundError,play,enable,mute};
}
