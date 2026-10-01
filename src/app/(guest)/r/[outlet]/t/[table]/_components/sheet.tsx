"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, type ReactNode } from "react";

// Bottom sheet for the bill and after-visit screens (G8, G9), on the native dialog: focus stays
// inside, Escape and the backdrop close it, and reading starts at the title.

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function Sheet({
  title,
  closeLabel,
  busy = false,
  onClose,
  children,
  center = false,
}: {
  title: string;
  closeLabel: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  center?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
        heading.current?.focus();
      } catch {
        // Already open in another layer
      }
    }
    return () => {
      try {
        dialog?.close();
      } catch {
        // Already closed
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className={`fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[92dvh] w-full max-w-[480px] animate-sheet overflow-y-auto rounded-t-sheet border-t border-line bg-paper px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-ink shadow-[var(--shadow-sheet)] backdrop:bg-ink/40 ${center ? "text-center" : ""}`}
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden />
      <div className="flex items-start gap-3">
        <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 pt-2 font-display text-title font-bold break-words outline-none">
          {title}
        </h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label={closeLabel} className={`-mr-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-ink/5 ${focusRing}`}>
          <HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}
