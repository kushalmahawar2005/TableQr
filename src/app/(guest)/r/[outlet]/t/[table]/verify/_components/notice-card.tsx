import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/** A problem explained inside the form, just above the button that resolves it */
export function NoticeCard({
  icon,
  title,
  body,
  tone = "danger",
}: {
  icon: IconSvgElement;
  title: string;
  body?: string;
  /** neutral: not an error, just something the guest cannot do here */
  tone?: "danger" | "neutral";
}) {
  const danger = tone === "danger";
  return (
    <div
      role={danger ? "alert" : "status"}
      className={`flex animate-fade items-start gap-3 rounded-cta px-4 py-3.5 ${
        danger ? "bg-[var(--state-seated-soft)] ring-1 ring-danger/10 ring-inset" : "border border-line bg-surface"
      }`}
    >
      <HugeiconsIcon icon={icon} size={20} className={`shrink-0 ${danger ? "text-danger" : "text-muted"}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-body font-semibold ${danger ? "text-danger" : "text-ink"}`}>{title}</p>
        {body && <p className="mt-1 text-caption text-ink/70">{body}</p>}
      </div>
    </div>
  );
}
