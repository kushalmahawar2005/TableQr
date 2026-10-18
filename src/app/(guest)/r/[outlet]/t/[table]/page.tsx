import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { parseLang, LANG_COOKIE, type Lang } from "@/lib/i18n";
import { DEVICE_COOKIE } from "@/lib/guest-device";
import { AppError } from "@/server/errors";
import { getTableLanding } from "@/server/guest/table";
import { LandingNotFound, LandingView } from "./_components/landing-view";
import { LandingSkeleton } from "./_components/landing-skeleton";

// QR addresses are private to the table; keep them out of search results
export const metadata: Metadata = { title: "Your table", robots: { index: false, follow: false } };

// G1 Landing. Rendered per request so the table state is live; the skeleton streams first.
export default async function TableLandingPage(props: PageProps<"/r/[outlet]/t/[table]">) {
  const { outlet, table } = await props.params;
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;

  return (
    <Suspense fallback={<LandingSkeleton lang={lang} />}>
      <Landing outletCode={outlet} shortCode={table} deviceId={deviceId} lang={lang} />
    </Suspense>
  );
}

async function Landing({
  outletCode,
  shortCode,
  deviceId,
  lang,
}: {
  outletCode: string;
  shortCode: string;
  deviceId: string | null;
  lang: Lang;
}) {
  let data;
  try {
    data = await getTableLanding(outletCode, shortCode, deviceId);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") return <LandingNotFound lang={lang} />;
    throw err;
  }

  // A phone already at this table goes straight back to it
  if (data.landing.kind === "rejoin") redirect(`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/menu`);
  if (data.landing.kind === "settling" && data.landing.isParticipant) {
    redirect(`/r/${encodeURIComponent(outletCode)}/t/${encodeURIComponent(shortCode)}/orders`);
  }
  // A hotel room has its own page: room service and housekeeping
  if (data.table.isRoom) redirect(`/r/${encodeURIComponent(outletCode)}/room/${encodeURIComponent(shortCode)}`);

  return <LandingView data={data} lang={lang} shortCode={shortCode} />;
}
