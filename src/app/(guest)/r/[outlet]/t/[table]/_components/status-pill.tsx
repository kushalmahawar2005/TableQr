import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/** Table-state tones from Foundation v1, plus the restaurant's own tone for friendly states */
export type Tone = "available" | "held" | "reserved" | "seated" | "bill" | "paid" | "cleaning" | "blocked" | "brand";

const toneVars = (tone: Tone) =>
  tone === "brand"
    ? { color: "var(--brand-strong)", background: "var(--brand-soft)", borderColor: "var(--brand-border)" }
    : {
        color: `var(--state-${tone}-text)`,
        background: `var(--state-${tone}-soft)`,
        borderColor: `var(--state-${tone})`,
      };

/** Status is never colour alone: every pill carries an icon and a word */
export function StatusPill({ tone, icon, label }: { tone: Tone; icon: IconSvgElement; label: string }) {
  return (
    <span
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1.5 text-body font-semibold ${
        tone === "held" ? "border-dashed" : ""
      }`}
      style={toneVars(tone)}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface/80">
        <HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} aria-hidden />
      </span>
      {label}
    </span>
  );
}
