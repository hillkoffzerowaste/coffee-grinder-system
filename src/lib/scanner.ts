"use client";

import { useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";

// Hardware digit positions are stable across Thai/English keyboard layouts.
export function scannerDigit(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "metaKey">) {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ?? null;
}

const SCAN_MAX_GAP_MS = 35;
const SCAN_MAX_TOTAL_MS = 1000;

// Hybrid input: normal text is untouched until an entire physical-digit burst
// ends with Enter. Timing is a heuristic: fast manual digit-position typing can
// look identical to hardware, and slow hardware must be entered in English.
export function useScannerInput(ref: RefObject<HTMLInputElement | null>, setValue: Dispatch<SetStateAction<string>>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const input = ref.current;
    if (!input) return;
    let burst: { raw: string; digits: string; first: number; last: number } | null = null;
    let composing = false;
    const reset = () => { burst = null; };
    const atEnd = () => input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const withinTime = (time: number) => burst !== null && time >= burst.last
      && time - burst.last <= SCAN_MAX_GAP_MS && time - burst.first <= SCAN_MAX_TOTAL_MS;
    const onKey = (event: KeyboardEvent) => {
      if (input.disabled || input.readOnly || !input.isConnected || event.defaultPrevented
        || composing || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        reset(); return;
      }
      const time = event.timeStamp;
      if (event.key === "Enter") {
        const digits = burst && burst.digits.length >= 4 && withinTime(time)
          && input.value === burst.raw && atEnd() ? burst.digits : null;
        reset();
        if (digits !== null) {
          // Capture runs before React's bubbling key/submit handlers. Commit both
          // representations now, including when all events share one React batch.
          input.value = digits;
          input.setSelectionRange(digits.length, digits.length);
          flushSync(() => setValue(digits));
        }
        return; // Keep native Enter submission enabled.
      }
      const digit = scannerDigit(event);
      if (digit === null || event.key.length !== 1) { reset(); return; }
      if (burst && (input.value !== burst.raw || !atEnd() || !withinTime(time))) reset();
      if (!burst) {
        // Never normalize the suffix of a manually typed name or an edited SKU.
        if (input.value !== "" && !(input.selectionStart === 0 && input.selectionEnd === input.value.length)) return;
        burst = { raw: "", digits: "", first: time, last: time };
      }
      burst.raw += event.key;
      burst.digits += digit;
      burst.last = time;
    };
    const onInput = (event: Event) => {
      const edit = event as InputEvent;
      if (composing || edit.isComposing || edit.inputType !== "insertText" || input.value !== burst?.raw) reset();
    };
    const onCompositionStart = () => { composing = true; reset(); };
    const onCompositionEnd = () => { composing = false; reset(); };
    const interruptions = ["paste", "cut", "drop", "blur", "pointerdown"] as const;
    input.addEventListener("keydown", onKey, true);
    input.addEventListener("input", onInput);
    input.addEventListener("compositionstart", onCompositionStart);
    input.addEventListener("compositionend", onCompositionEnd);
    for (const event of interruptions) input.addEventListener(event, reset);
    return () => {
      input.removeEventListener("keydown", onKey, true);
      input.removeEventListener("input", onInput);
      input.removeEventListener("compositionstart", onCompositionStart);
      input.removeEventListener("compositionend", onCompositionEnd);
      for (const event of interruptions) input.removeEventListener(event, reset);
    };
  }, [ref, setValue, enabled]);
}

// Operational pages should be ready for the next hardware scan after any completed action.
export function useScannerFocus(ref: RefObject<HTMLInputElement | null>, unavailable = false) {
  useEffect(() => {
    const focus = () => {
      if (unavailable || document.querySelector("dialog[open]")) return;
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
