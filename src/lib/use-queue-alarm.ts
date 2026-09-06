"use client";
import { useEffect } from "react";
import type { SoundKind } from "./use-sounds";

export const QUEUE_ALARM_INTERVAL_MS = 3000;

export function useQueueAlarm(hasQueuedWork: boolean, enabled: boolean, play: (kind: SoundKind) => void) {
  useEffect(() => {
    if (!hasQueuedWork || !enabled) return;
    const initial=setTimeout(()=>play("newJob"),0);
    const repeat=setInterval(()=>play("newJob"),QUEUE_ALARM_INTERVAL_MS);
    return()=>{clearTimeout(initial);clearInterval(repeat);};
  }, [hasQueuedWork, enabled, play]);
}
