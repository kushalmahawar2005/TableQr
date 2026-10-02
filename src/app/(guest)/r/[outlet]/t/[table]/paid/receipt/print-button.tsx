"use client";

/** Opens the phone's print sheet, which also saves the document as a PDF */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="min-h-12 w-full rounded-cta border border-line bg-surface px-4 text-button font-semibold text-ink print:hidden focus-visible:outline-2 focus-visible:outline-brand">
      {label}
    </button>
  );
}
