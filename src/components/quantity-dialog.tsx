"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./quantity-dialog.css";

type QuantityDialogProps = {
  title: string;
  description: string;
  max: number;
  initial?: number;
  busy?: boolean;
  locked?: boolean;
  error?: string;
  onConfirm: (quantity: number) => void;
  onAddAnother?: (quantity: number) => void;
  confirmLabel?: string;
  onCancel: () => void;
  children?: ReactNode;
};

// The parent mounts this only while open and restores scanner focus on dismissal.
export function QuantityDialog({
  title, description, max, initial = 1, busy = false, locked = false, error,
  onConfirm, onAddAnother, confirmLabel = "ยืนยันจำนวน", onCancel, children,
}: QuantityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [quantity, setQuantity] = useState(String(initial));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="quantity-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={`${id}-title`} className="quantity-dialog__title">{title}</h2>
      <p id={`${id}-description`} className="quantity-dialog__description">{description}</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const value = inputRef.current?.valueAsNumber ?? Number.NaN;
        if (!Number.isInteger(value) || value < 1 || (!locked && !(value <= max))) return;
        if (!event.currentTarget.reportValidity()) return;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter?.getAttribute("value") === "add-another") {
          if (!locked) onAddAnother?.(value);
        } else onConfirm(value);
      }}>
        <fieldset className="quantity-dialog__fields" disabled={busy}>
          <div className="quantity-dialog__field">
            <label htmlFor="quantity">จำนวนถุง</label>
            <input
              ref={inputRef}
              id="quantity"
              name="quantity"
              type="number"
              min={1}
              max={max}
              step={1}
              required
              disabled={locked}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="quantity-dialog__input"
              aria-describedby={`${id}-range${error ? ` ${id}-error` : ""}`}
            />
            <small id={`${id}-range`} className="quantity-dialog__range">จำนวนเต็ม 1–{max} ถุง</small>
          </div>
          {children != null && <div className="quantity-dialog__children">{children}</div>}
        </fieldset>
        {error && <div id={`${id}-error`} className="quantity-dialog__error" role="alert">{error}</div>}
        <div className="quantity-dialog__actions">
          <button type="button" disabled={busy} onClick={() => { if (!busy) onCancel(); }} className="quantity-dialog__button quantity-dialog__button--cancel">ยกเลิก</button>
          {onAddAnother && <button type="submit" name="quantity-action" value="add-another" disabled={busy || locked} className="quantity-dialog__button quantity-dialog__button--cancel">เพิ่มรายการถัดไป</button>}
          <button type="submit" name="quantity-action" value="confirm" disabled={busy} className="quantity-dialog__button quantity-dialog__button--confirm">{busy ? "กำลังดำเนินการ..." : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
