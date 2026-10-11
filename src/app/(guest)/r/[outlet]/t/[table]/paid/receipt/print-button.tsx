"use client";

/** Opens the phone's print sheet, which also saves the document as a PDF */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-12 w-full rounded-cta border border-line bg-surface px-4 text-button font-semibold text-ink print:hidden focus-visible:outline-2 focus-visible:outline-brand">
      {label}
    </button>
  );
}

/** Shares the bill as a WhatsApp message; the guest picks the chat (themselves, or the friends who split it) */
export function ShareButton({ label, text }: { label: string; text: string }) {
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="flex min-h-12 w-full items-center justify-center rounded-cta bg-[#1f8f4e] px-4 text-button font-semibold text-white print:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {label}
    </a>
  );
}
