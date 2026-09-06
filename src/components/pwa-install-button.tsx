"use client";

import {useEffect,useState} from "react";

interface InstallPromptEvent extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:"accepted"|"dismissed";platform:string}>;
}

export function PwaInstallButton(){
  const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
  const [installed,setInstalled]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    let active=true;
    const standalone=window.matchMedia?.("(display-mode: standalone)").matches??false;
    if(standalone)queueMicrotask(()=>{if(active)setInstalled(true);});
    const onPrompt=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent);setMessage("");};
    const onInstalled=()=>{setInstalled(true);setPrompt(null);setMessage("");};
    window.addEventListener("beforeinstallprompt",onPrompt);
    window.addEventListener("appinstalled",onInstalled);
    return()=>{active=false;window.removeEventListener("beforeinstallprompt",onPrompt);window.removeEventListener("appinstalled",onInstalled);};
  },[]);

  async function install(){
    if(!prompt){setMessage("ติดตั้งผ่านเมนู Apps ของ Chrome หรือ Edge ได้");return;}
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      setPrompt(null);
      if(choice.outcome==="accepted")setInstalled(true);
      else setMessage("ยังไม่ได้ติดตั้งแอป");
    }catch{setMessage("เปิดหน้าติดตั้งไม่ได้ กรุณาใช้เมนู Apps ของเบราว์เซอร์");}
  }

  return <div className="pwa-install">
    <button type="button" className="button secondary" disabled={installed} onClick={()=>void install()}>{installed?"ติดตั้งแล้ว":"ติดตั้งแอปบน Desktop"}</button>
    {message&&<span className="pwa-install-message" role="status">{message}</span>}
  </div>;
}
