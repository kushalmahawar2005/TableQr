import { SUPPORT_PHONE, supportCallUrl, supportWhatsAppUrl } from "@/lib/support";

/** Call or WhatsApp TableQR, with the restaurant's request already written */
export function ContactTableQR({ message, compact = false }: { message: string; compact?: boolean }) {
  const base = compact
    ? "inline-flex min-h-9 items-center rounded-cta bg-white/90 px-3 text-caption font-semibold text-[#1f2937]"
    : "inline-flex min-h-11 items-center rounded-cta border border-line bg-surface px-4 text-button font-semibold text-ink hover:bg-ink/5";
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      <a href={supportWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer" className={base}>WhatsApp TableQR</a>
      <a href={supportCallUrl()} className={base}>{compact ? "Call" : `Call ${SUPPORT_PHONE}`}</a>
    </span>
  );
}
