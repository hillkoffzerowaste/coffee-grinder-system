"use client";

import { useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";

// Hardware digit positions are stable across Thai/English keyboard layouts.
export function scannerDigit(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "metaKey">) {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ?? null;
}

export function useScannerInput(ref: RefObject<HTMLInputElement | null>, setValue: Dispatch<SetStateAction<string>>) {
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onKey = (event: KeyboardEvent) => {
      const digit = scannerDigit(event);
      if (digit === null || input.disabled) return;
      event.preventDefault();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const value = input.value.slice(0, start) + digit + input.value.slice(end);
      // Keep the DOM buffer current even when scanner events share one React batch.
      input.value = value; input.setSelectionRange(start + 1, start + 1);
      setValue(value);
    };
    input.addEventListener("keydown", onKey);
    return () => input.removeEventListener("keydown", onKey);
  }, [ref, setValue]);
}

// Operational pages should be ready for the next hardware scan after any completed action.
export function useScannerFocus(ref: RefObject<HTMLInputElement | null>, unavailable = false) {
  useEffect(() => {
    const focus = () => {
      const input = ref.current;
      if (input && input.isConnected && !input.disabled) input.focus({ preventScroll: true });
    };
    const scheduleFocus = () => queueMicrotask(focus);
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select")) return;
      scheduleFocus();
    };
    const onChange = (event: Event) => { if (event.target !== ref.current) scheduleFocus(); };
    focus();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("change", onChange); };
  }, [ref, unavailable]);
}
