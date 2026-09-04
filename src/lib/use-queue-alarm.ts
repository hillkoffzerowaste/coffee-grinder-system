"use client";
import { useEffect, useRef } from "react";
import type { SoundKind } from "./use-sounds";

export const QUEUE_REMINDER_INTERVAL_MS = 15000;
export const SLA_REMINDER_INTERVAL_MS = 10000;

export function useQueueAlarm(queuedCount: number, hasOverdueWork: boolean, enabled: boolean, play: (kind: SoundKind) => void) {
  const previousCount = useRef(queuedCount);
  const hasQueuedWork = queuedCount > 0;

  useEffect(() => {
    if (enabled && queuedCount > previousCount.current) play("newJob");
    previousCount.current = queuedCount;
  }, [queuedCount, enabled, play]);

  useEffect(() => {
    if (!hasQueuedWork || !enabled) return;
    const kind:SoundKind=hasOverdueWork?"overdue":"pending";
    const interval=hasOverdueWork?SLA_REMINDER_INTERVAL_MS:QUEUE_REMINDER_INTERVAL_MS;
    const repeat=setInterval(()=>play(kind),interval);
    return()=>clearInterval(repeat);
  }, [hasQueuedWork, hasOverdueWork, enabled, play]);
}
