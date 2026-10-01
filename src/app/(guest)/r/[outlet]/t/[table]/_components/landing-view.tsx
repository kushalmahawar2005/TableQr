import {
  Calendar03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CleaningBucketIcon,
  Clock01Icon,
  HelpCircleIcon,
  Invoice01Icon,
  Moon02Icon,
  QrCodeIcon,
  SmartPhone01Icon,
  SquareLock02Icon,
  Store01Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { CSSProperties } from "react";
import { brandStyle, deriveBrandTokens } from "@/domain/brand";
import { formatClock, formatWeekday, type Lang } from "@/lib/i18n";
import type { TableLanding } from "@/server/guest/table";
import { g1Copy, type G1Copy } from "../_copy";
import { LanguageToggle } from "./language-toggle";
import { OutletHeader } from "./outlet-header";
import { StartCta } from "./start-cta";
import { StatusPill, type Tone } from "./status-pill";
import { CardMessage, PeopleHere, TableCard } from "./table-card";

type Pill = { tone: Tone; icon: IconSvgElement; label: string };
type View = {
  pill: Pill;
  message?: { title: string; body?: string };
  people?: { names: string[] | null; line: string; hostLine?: string };
  cta?: "start" | "join" | "ask_staff";
  /** No table identity to show: revoked code or suspended restaurant */
  hideTable?: boolean;
};

/** What each landing state shows (G1 state matrix). One primary action at most. */
function describe(data: TableLanding, c: G1Copy, lang: Lang): View {
  const { landing, outlet } = data;
  // Open mode goes straight in; Verified mode confirms the number on G2 first
  const canStart = outlet.sessionMode === "open" || outlet.sessionMode === "verified";

  switch (landing.kind) {
    case "start":
    case "rejoin":
      return {
        pill: { tone: "available", icon: CheckmarkCircle02Icon, label: c.pill.available },
        cta: canStart ? "start" : "ask_staff",
      };
    case "join":
      return {
        pill: { tone: "brand", icon: UserGroupIcon, label: c.pill.inUse },
        people: {
          names: landing.names,
          line: landing.names ? c.peopleHere(landing.names) : c.peopleCount(landing.count),
          hostLine: landing.hostName ? c.hostIs(landing.hostName) : undefined,
        },
        cta: canStart ? "join" : "ask_staff",
      };
    case "reserved":
      return { pill: { tone: "reserved", icon: Calendar03Icon, label: c.pill.reserved }, message: c.reserved };
    case "settling":
      return {
        pill: { tone: "bill", icon: Invoice01Icon, label: c.pill.settling },
        message: landing.isParticipant ? c.settlingMine : c.settling,
      };
    case "preparing":
      return { pill: { tone: "paid", icon: CleaningBucketIcon, label: c.pill.preparing }, message: c.preparing };
    case "blocked":
      return { pill: { tone: "blocked", icon: Cancel01Icon, label: c.pill.blocked }, message: c.preparing };
    case "closed": {
      const next = outlet.nextOpen;
      const when = !next ? null : next.inDays === 0 ? "today" : next.inDays === 1 ? "tomorrow" : formatWeekday(next.day, lang);
      return {
        pill: { tone: "paid", icon: Moon02Icon, label: c.pill.closed },
        message: {
          title: c.closed.title(outlet.name),
          body: next && when ? c.opens(when, formatClock(next.time, lang)) : undefined,
        },
      };
    }
    case "awaiting_staff":
      return { pill: { tone: "paid", icon: Clock01Icon, label: c.pill.awaitingStaff }, message: c.awaitingStaff };
    case "code_required":
      return { pill: { tone: "paid", icon: SquareLock02Icon, label: c.pill.codeRequired }, message: c.codeRequired };
    case "revoked":
      return { hideTable: true, pill: { tone: "blocked", icon: QrCodeIcon, label: c.pill.codeInactive }, message: c.revoked };
    case "unavailable":
      return { hideTable: true, pill: { tone: "blocked", icon: Store01Icon, label: c.pill.notAvailable }, message: c.unavailable };
  }
}

export function LandingView({
  data,
  lang,
  shortCode,
  preview,
}: {
  data: TableLanding;
  lang: Lang;
  shortCode: string;
  /** Dev preview: renders without a full-height screen and without calling the server */
  preview?: boolean;
}) {
  const c = g1Copy[lang];
  const { outlet, table } = data;
  const v = describe(data, c, lang);
  const style = brandStyle(deriveBrandTokens(outlet.accentColor)) as CSSProperties;
  const welcoming = v.cta === "start" || v.cta === "join";

  const subline = [
    outlet.city,
    !outlet.isOpen ? c.closedNow : outlet.closesAt ? c.openTill(formatClock(outlet.closesAt, lang)) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <GuestFrame lang={lang} style={style} preview={preview}>
      <OutletHeader
        name={outlet.name}
        logoUrl={outlet.logoUrl}
        subline={subline}
        aside={<LanguageToggle lang={lang} label={c.language} preview={preview} />}
      />

      <main className="flex flex-1 flex-col pt-3">
        <TableCard
          className={welcoming ? "animate-rise" : "animate-fade"}
          eyebrow={c.youAreAt}
          title={v.hideTable ? undefined : c.table(table.code)}
          meta={[c.seats(table.maxSeats), table.zone].join(" · ")}
          summary={v.hideTable ? undefined : c.tableSummary(table.code, table.maxSeats, table.zone, v.pill.label)}
          status={<StatusPill {...v.pill} />}
        >
          {v.people && <PeopleHere {...v.people} />}
          {v.message && <CardMessage {...v.message} large={v.hideTable} />}
        </TableCard>

        {/* The action sits right under the table it acts on */}
        {welcoming ? (
          <div className="mt-4 animate-fade [animation-delay:120ms]">
            <StartCta
              outletCode={outlet.code}
              shortCode={shortCode}
              label={v.cta === "join" ? c.joinTable(table.code) : c.startOrdering}
              ariaLabel={v.cta === "join" ? c.joinTable(table.code) : c.startingFor(table.code)}
              pendingLabel={c.opening}
              askStaffText={c.askStaffToContinue}
              failedText={c.actionError}
              preview={preview}
            />
            <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-caption text-muted">
              <HugeiconsIcon icon={QrCodeIcon} size={14} className="mt-px shrink-0" aria-hidden />
              {c.notYourTable}
            </p>
          </div>
        ) : v.cta === "ask_staff" ? (
          <p role="status" className="mt-4 rounded-cta border border-line bg-surface px-4 py-4 text-center text-body font-semibold text-ink">
            {c.askStaffToContinue}
          </p>
        ) : null}

        {v.cta && (
          <ul className="mt-7 grid animate-fade grid-cols-3 gap-2 [animation-delay:200ms]">
            {c.reassurances.map((r, i) => (
              <li key={r.title} className="flex flex-col items-center gap-1.5 text-center">
                <HugeiconsIcon
                  icon={[SmartPhone01Icon, Wallet01Icon, UserGroupIcon][i]}
                  size={18}
                  strokeWidth={1.6}
                  className="text-brand"
                  aria-hidden
                />
                <span className="text-caption text-muted">{r.title}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-8 pb-[max(20px,env(safe-area-inset-bottom))]">
          {outlet.poweredBy && <p className="text-center text-label text-muted">{c.poweredBy}</p>}
        </div>
      </main>
    </GuestFrame>
  );
}

function GuestFrame({
  lang,
  style,
  preview,
  children,
}: {
  lang: Lang;
  style?: CSSProperties;
  preview?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div lang={lang} style={style} className={`flex flex-col ${preview ? "min-h-full" : "min-h-dvh"}`}>
      {children}
    </div>
  );
}

/** Unknown QR: there is no restaurant to brand, so the page stays neutral */
export function LandingNotFound({ lang, preview }: { lang: Lang; preview?: boolean }) {
  const c = g1Copy[lang];
  return (
    <GuestFrame lang={lang} preview={preview}>
      <OutletHeader name="TableQR" logoUrl={null} subline="" aside={<LanguageToggle lang={lang} label={c.language} preview={preview} />} />
      <main className="pt-3">
        <TableCard className="animate-fade" status={<StatusPill tone="paid" icon={HelpCircleIcon} label={c.pill.notFound} />}>
          <CardMessage {...c.notFound} large />
        </TableCard>
      </main>
    </GuestFrame>
  );
}
