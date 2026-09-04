"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import type { GrindLookup } from "./types";
export function useCatalog() {
  const [grinds,setGrinds]=useState<GrindLookup[]>([]);
  const [grinders,setGrinders]=useState<{id:string;name:string}[]>([]);
  const [catalogError,setError]=useState("");
  const mounted=useRef(false);
  const reloadCatalog=useCallback(async()=>{
    try {
      const data=await apiFetch<{grinds:GrindLookup[];grinders:{id:string;name:string}[]}>("/api/catalog/options");
      if(mounted.current){setGrinds(data.grinds??[]);setGrinders(data.grinders??[]);setError("");}
    } catch {if(mounted.current)setError("โหลดบาร์โค้ดเบอร์บด/รายชื่อผู้บดไม่สำเร็จ กรุณาลองใหม่");}
  },[]);
  useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)return reloadCatalog();});return()=>{mounted.current=false;};},[reloadCatalog]);
  return {grinds,grinders,catalogError,reloadCatalog};
}
