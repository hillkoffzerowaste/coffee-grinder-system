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
