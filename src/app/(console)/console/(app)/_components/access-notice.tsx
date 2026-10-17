import type { Access } from "@/server/access";
import { signOutAction } from "../../login/actions";
import { RenewButton } from "./request-upgrade";

// What staff see when the free trial or paid period ends: a warning first, then a paused screen.
// Nothing is deleted; renewing in the admin brings everything back at once.

const day = (ms: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(ms));
const what = (reason: string) => (reason === "trial" ? "free trial" : "TableQR plan");

/** Replaces every staff screen once the grace days are over, or when TableQR has paused the restaurant */
export function PausedScreen({ access, canAsk }: { access: Extract<Access, { state: "blocked" }>; canAsk: boolean }) {
  const paused = access.reason === "suspended" || access.reason === "cancelled";
  return (
    <main className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
      <div className="max-w-md">
        <p className="text-caption font-semibold uppercase tracking-wider text-muted">TableQR</p>
        <h1 className="mt-2 font-display text-title font-bold text-ink">{paused ? "TableQR is paused for this restaurant" : `Your ${what(access.reason)} has ended`}</h1>
        <p className="mt-2 text-body text-muted">
          {access.endsAt ? `It ended on ${day(access.endsAt)}. ` : ""}Orders, billing and the QR menu are stopped. Your menu, bills and customers are safe; once TableQR renews your plan, everything comes back at once.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          {canAsk ? <RenewButton /> : <p className="text-body font-semibold text-ink">Please tell the owner.</p>}
          <form action={signOutAction}><button type="submit" className="min-h-11 text-body font-semibold text-muted underline underline-offset-4">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}

/** A strip above staff screens: the trial or plan ends soon, or has ended and is in its grace days */
export function AccessBanner({ access, canAsk }: { access: Access; canAsk: boolean }) {
  if (access.state === "ok" && (!access.warn || access.endsAt === null)) return null;
  if (access.state === "blocked") return null;
  const grace = access.state === "grace";
  return (
    <div role="status" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2 text-center text-caption font-semibold text-white print:hidden ${grace ? "bg-[var(--danger,#d92d20)]" : "bg-[#b54708]"}`}>
      <span>
        {grace
          ? `Your ${what(access.reason)} ended on ${day(access.endsAt)}. Orders and billing stop on ${day(access.stopsAt)}.`
          : `Your ${what(access.reason)} ends on ${day(access.endsAt!)}.`}
      </span>
      {canAsk && <RenewButton compact />}
    </div>
  );
}
