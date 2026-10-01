import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { FormSnapshot } from "@/app/(guest)/r/[outlet]/t/[table]/verify/_components/verify-form";
import { VerifyScreen, type VerifyScreenData } from "@/app/(guest)/r/[outlet]/t/[table]/verify/_components/verify-screen";
import { parseLang } from "@/lib/i18n";

export const metadata: Metadata = { title: "G2 states (dev)", robots: { index: false, follow: false } };

// Development-only review board: every G2 state side by side with sample data. Never in production.

// Foundation type sizes (size / line height, px), doubled for the 200% text check
const TYPE = { title: [22, 28], section: [16, 22], body: [14, 20], caption: [12, 16], label: [11, 14], button: [14, 20] };
const BIG_TEXT = Object.entries(TYPE)
  .map(([k, [size, lh]]) => `[data-big] .text-${k}{font-size:${size * 2}px;line-height:calc(${lh * 2}px * var(--lh))}`)
  .concat("[data-big] input{font-size:32px}")
  .join("\n");

const start: VerifyScreenData = {
  outlet: { code: "SRJ01", name: "Spice Route", logoUrl: null, accentColor: "#E4572E" },
  tableCode: "T12",
  context: { kind: "start" },
};
const join: VerifyScreenData = { ...start, context: { kind: "join", count: 3 } };

const filled = { name: "Aarav", phone: "9876543210" };
const sent: FormSnapshot = { ...filled, step: "code", expiresIn: 280, resendIn: 22 };

const states: { id: string; label: string; data?: VerifyScreenData; form: FormSnapshot; sheet?: boolean }[] = [
  { id: "initial", label: "1 · Initial (first guest)", form: {} },
  { id: "join", label: "1b · Initial (joining 3 people)", data: join, form: {} },
  { id: "filled", label: "2–3 · Name + phone entered", form: filled },
  { id: "bad-phone", label: "4 · Invalid phone", form: { name: "Aarav", phone: "58765", phoneTouched: true } },
  { id: "bad-name", label: "Name with emoji / symbols", form: { name: "Aarav 😀", phone: "9876543210" } },
  { id: "intl", label: "International number", form: { name: "Aarav", country: "AE", phone: "501234567" } },
  { id: "sending", label: "Sending code (loading)", form: { ...filled, busy: "sending" } },
  { id: "sent", label: "5 · Code sent, resend countdown", form: { ...sent, focusCode: true } },
  { id: "partial", label: "6 · Partial code", form: { ...sent, code: "47", focusCode: true } },
  { id: "complete", label: "7 · Code complete (no auto-submit)", form: { ...sent, code: "4791" } },
  { id: "consent", label: "Consent checked", form: { ...sent, code: "4791", consent: true } },
  { id: "verifying", label: "Verifying (loading)", form: { ...sent, code: "4791", busy: "verifying" } },
  { id: "wrong", label: "8 · Wrong code", form: { ...sent, code: "4712", problem: "wrong" } },
  { id: "locked", label: "9 · Three wrong → 60 s lockout", form: { ...sent, lockedFor: 47 } },
  { id: "resend", label: "10–11 · Resend available", form: { ...sent, resendIn: 0 } },
  { id: "expired", label: "12 · Expired / lockout over", form: { ...sent, problem: "expired" } },
  { id: "sms-failed", label: "SMS could not be sent", form: { ...filled, problem: "sms_failed" } },
  { id: "rate", label: "Too many codes requested", form: { ...filled, problem: "rate_limited" } },
  { id: "network", label: "16 · Network failure", form: { ...filled, problem: "network" } },
  { id: "why", label: "Why we ask (bottom sheet)", form: {}, sheet: true },
  {
    id: "brand",
    label: "Other brand · green accent · long name",
    data: { ...start, outlet: { code: "CNJ01", name: "Cafe Nukkad and Rooftop Kitchen", logoUrl: null, accentColor: "#39FF14" }, tableCode: "B3" },
    form: { ...sent, code: "4791", consent: true },
  },
];

export default async function G2Preview(props: PageProps<"/dev/g2">) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await props.searchParams;
  const lang = parseLang(query.lang as string | undefined);

  // ?solo=<id> shows one state alone at the window's size, for phone-size screenshots.
  // &text=2 doubles every text size to check 200% text.
  const solo = states.find((s) => s.id === query.solo);
  if (solo) {
    const big = query.text === "2";
    return (
      <div data-big={big || undefined} className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
        {big && <style>{BIG_TEXT}</style>}
        <VerifyScreen data={solo.data ?? start} shortCode="k7Qm" lang={lang} preview={solo.form} sheetOpen={solo.sheet} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#ECE7DF] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-title font-bold">G2 Verify number: all states</h1>
        <a className="text-body font-semibold text-accent underline" href="?lang=en">English</a>
        <a className="text-body font-semibold text-accent underline" href="?lang=hi">Hindi</a>
        <p className="text-caption text-muted">Development only. Buttons do nothing here; timers are frozen.</p>
      </header>
      <div className="flex flex-wrap items-start gap-6">
        {states.map((s) => (
          <figure key={s.id} id={s.id} className="w-[360px]">
            <figcaption className="mb-2 text-caption font-semibold text-muted">{s.label}</figcaption>
            <div className="relative h-[760px] overflow-hidden rounded-[28px] border border-line bg-paper px-5 shadow-[var(--shadow-float)] [&>div]:min-h-full">
              <VerifyScreen data={s.data ?? start} shortCode="k7Qm" lang={lang} preview={s.form} sheetOpen={s.sheet} />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
