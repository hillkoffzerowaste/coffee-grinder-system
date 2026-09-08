"use client";
import { useEffect } from "react";
import type { SoundKind } from "./use-sounds";

export const QUEUE_ALARM_INTERVAL_MS = 3000;
// SLA เตือนห่างกว่ามาก เพราะคนถืองานอยู่แล้ว ต้องการแค่ให้รู้ตัว ไม่ใช่เร่งทุก 3 วินาที
export const SLA_ALARM_INTERVAL_MS = 20000;

function useRepeatingAlarm(active: boolean, enabled: boolean, play: (kind: SoundKind) => void, kind: SoundKind, intervalMs: number) {
  useEffect(() => {
    if (!active || !enabled) return;
    const initial=setTimeout(()=>play(kind),0);
    const repeat=setInterval(()=>play(kind),intervalMs);
    return()=>{clearTimeout(initial);clearInterval(repeat);};
  }, [active, enabled, play, kind, intervalMs]);
}

export function useQueueAlarm(hasQueuedWork: boolean, enabled: boolean, play: (kind: SoundKind) => void) {
  useRepeatingAlarm(hasQueuedWork, enabled, play, "newJob", QUEUE_ALARM_INTERVAL_MS);
}

export function useSlaAlarm(overdue: boolean, enabled: boolean, play: (kind: SoundKind) => void) {
  useRepeatingAlarm(overdue, enabled, play, "slaDue", SLA_ALARM_INTERVAL_MS);
}
