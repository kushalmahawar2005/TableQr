import type { ReactNode } from "react";
import { OutletLogo } from "./outlet-logo";

/**
 * Restaurant identity: logo (or the name's initial), name, and city with today's hours.
 * Deliberately smaller than the table card: the table is what a guest must not get wrong.
 */
export function OutletHeader({
  name,
  logoUrl,
  subline,
  aside,
}: {
  name: string;
  logoUrl: string | null;
  subline: string;
  aside?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 pt-5 pb-2">
      <OutletLogo name={name} logoUrl={logoUrl} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-section font-bold text-ink">{name}</p>
        <p className="text-caption text-muted">{subline}</p>
      </div>
      {aside}
    </header>
  );
}
