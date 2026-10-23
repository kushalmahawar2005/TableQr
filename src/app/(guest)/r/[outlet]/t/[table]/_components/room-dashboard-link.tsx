import Link from "next/link";
import { isRoomCode } from "@/domain/rooms";
import type { Lang } from "@/lib/i18n";

/** Keep the room-service dashboard one tap away throughout the room ordering flow. */
export function RoomDashboardLink({
  outletCode,
  shortCode,
  tableCode,
  lang,
  preview = false,
}: {
  outletCode: string;
  shortCode: string;
  tableCode: string;
  lang: Lang;
  preview?: boolean;
}) {
  if (!isRoomCode(tableCode)) return null;

  return (
    <Link
      href={preview ? "#" : `/r/${encodeURIComponent(outletCode)}/room/${encodeURIComponent(shortCode)}`}
      prefetch={false}
      aria-label={lang === "hi" ? "रूम डैशबोर्ड पर वापस जाएँ" : "Back to room dashboard"}
      className="mt-3 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-body font-semibold text-brand-strong hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span aria-hidden>←</span>
      {lang === "hi" ? "रूम डैशबोर्ड पर वापस" : "Back to room dashboard"}
    </Link>
  );
}
