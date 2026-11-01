// Drawn art for the guest loading and order tracking screens. Plain SVG, so it stays sharp and
// each restaurant's own colour carries through the tracking pictures.

const BROWN = "#7A5B45";
const halo = <circle cx="60" cy="48" r="40" fill="var(--brand-soft)" />;
const ground = <path d="M6 92h108" stroke="var(--muted)" strokeWidth="1" opacity=".5" />;

/** The bowl on the loading screen */
export function BowlArt() {
  return (
    <svg viewBox="0 -14 280 260" width="240" height="223" aria-hidden="true">
      <ellipse cx="140" cy="237" rx="120" ry="8" fill="var(--guest-bowl-shadow)" />
      <path d="M4 92c4 84 62 137 136 137s132-53 136-137z" fill="#E6D8C5" />
      <path d="M4 92c4 68 56 122 124 124 74 2 124-46 134-124z" fill="#F4EBDD" />
      <path d="M0 88c0-30 62-54 140-54s140 24 140 54-62 54-140 54S0 118 0 88" fill="#FFF8EC" />
      <ellipse cx="140" cy="84" rx="133" ry="44" fill="#BC5B3E" />
      <ellipse cx="140" cy="84" rx="126" ry="38" fill="#D5BC91" />
      <g fill="#F7EFD9"><ellipse cx="34" cy="99" rx="7" ry="5" /><ellipse cx="42" cy="110" rx="7" ry="5" /><ellipse cx="62" cy="95" rx="7" ry="5" /><ellipse cx="192" cy="109" rx="7" ry="5" /><ellipse cx="205" cy="102" rx="7" ry="5" /><ellipse cx="222" cy="99" rx="7" ry="5" /></g>
      <g transform="translate(-16 -28)"><path d="M59 48c-8-4-19 6-13 14-8 4-5 12 2 16-2 12 8 17 19 16 18 8 38 4 50-6L81 44c-4-14-20-10-22 4" fill="#728468" />
      <path d="M72 52c-6-16 8-22 16-16 2-14 26-14 31 0 10-8 34-4 37 14 2 8-6 12-6 18 8 6 2 14-6 18-8 8-22 14-38 16-20-8-36-26-34-50" fill="#A8B38E" />
      <path d="M115 92c10-14 18-32 25-52M103 76c2 4 5 12 8 8M118 66l18-8M101 46c3 10 8 20 14 26" fill="none" stroke="#728468" strokeWidth="3" strokeLinecap="round" /></g>
      <ellipse cx="145" cy="82" rx="26" ry="20" fill="#D0604A" />
      <ellipse cx="145" cy="82" rx="19" ry="14" fill="#ECA47E" />
      <path d="M145 70v11m0 0l-9 10m9-10l9 9" stroke="#D0604A" strokeWidth="5" />
      <ellipse cx="183" cy="52" rx="29" ry="21" fill="#728468" /><ellipse cx="183" cy="52" rx="23" ry="16" fill="#D0D3AD" />
      <ellipse cx="172" cy="46" rx="2" ry="4" fill="#F7EFD9" /><ellipse cx="189" cy="48" rx="2" ry="4" fill="#F7EFD9" />
      <ellipse cx="215" cy="75" rx="29" ry="21" fill="#728468" /><ellipse cx="215" cy="75" rx="23" ry="16" fill="#D0D3AD" />
      <ellipse cx="205" cy="72" rx="2" ry="4" fill="#F7EFD9" /><ellipse cx="225" cy="75" rx="2" ry="4" fill="#F7EFD9" />
    </svg>
  );
}

export function ReceiptArt({ cancelled = false }: { cancelled?: boolean }) {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true">
      {halo}{ground}
      <path d="M38 8h46v76l-7.6-6-7.7 6-7.7-6-7.7 6-7.6-6-8 6z" fill="var(--paper)" stroke={BROWN} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M46 18h30M46 27h20" stroke={BROWN} strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
      <circle cx="61" cy="55" r="12" fill="var(--surface)" />
      {cancelled ? <path d="M56 50l10 10m0-10l-10 10" stroke="var(--brand-main)" strokeWidth="2.2" strokeLinecap="round" /> : <path d="M55 55l4.5 4.5L67 51" fill="none" stroke="var(--brand-main)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function ClocheArt({ mark }: { mark: "steam" | "clock" | "check" }) {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true">
      {halo}{ground}
      {mark === "steam" && <path d="M46 26c-5-5 5-8 0-14M61 26c-5-5 5-8 0-14M76 26c-5-5 5-8 0-14" fill="none" stroke="var(--brand-main)" strokeWidth="1.8" strokeLinecap="round" />}
      <circle cx="60" cy="33" r="3.5" fill="var(--brand-main)" />
      <path d="M58 36h4v4h-4z" fill="var(--brand-main)" />
      <path d="M22 76c0-22 17-37 38-37s38 15 38 37z" fill="var(--paper)" stroke={BROWN} strokeWidth="1.5" />
      <path d="M31 70c1-12 9-20 19-23" fill="none" stroke={BROWN} strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <path d="M14 78h92c0 3-4 5-8 5H22c-4 0-8-2-8-5z" fill="var(--brand-main)" />
      {mark !== "steam" && <><circle cx="96" cy="26" r="11" fill="var(--surface)" stroke="var(--line)" />
        {mark === "clock" ? <><circle cx="96" cy="26" r="6.5" fill="none" stroke="var(--brand-main)" strokeWidth="1.6" /><path d="M96 22.5V26l2.5 1.5" fill="none" stroke="var(--brand-main)" strokeWidth="1.6" strokeLinecap="round" /></> : <path d="M91 26l3.5 3.5L101 23" fill="none" stroke="var(--brand-main)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}</>}
    </svg>
  );
}

export function BagArt() {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true">
      {halo}{ground}
      <path d="M46 30v-9a14 14 0 0128 0v9" fill="none" stroke={BROWN} strokeWidth="1.5" />
      <path d="M36 30h48l6 54H30z" fill="var(--paper)" stroke={BROWN} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M54 26h12v30a3 3 0 01-3 3h-6a3 3 0 01-3-3z" fill="var(--brand-main)" />
    </svg>
  );
}

/** Stands in for the map when no rider location has reached us yet */
export function RouteArt({ label, note }: { label: string; note: string }) {
  return (
    <figure>
      <div className="relative h-44 overflow-hidden rounded-2xl bg-brand-soft">
        <svg viewBox="0 0 340 176" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true">
          <path d="M0 46h340M0 112h340M70 0v176M180 0v176M284 0v176" stroke="var(--surface)" strokeWidth="9" opacity=".75" />
          <path d="M58 136h12v-24h110V46h104" fill="none" stroke="var(--brand-main)" strokeWidth="2.5" strokeDasharray="6 4" />
          <circle cx="44" cy="136" r="15" fill="var(--surface)" /><path d="M37 133h14l-1-5H38zM38 133v9h12v-9" fill="none" stroke="var(--brand-main)" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="180" cy="104" r="17" fill="var(--brand-main)" /><circle cx="174" cy="109" r="2.5" fill="#fff" /><circle cx="186" cy="109" r="2.5" fill="#fff" />
          <circle cx="284" cy="46" r="15" fill="var(--surface)" /><path d="M284 54s-7-7-7-12a7 7 0 0114 0c0 5-7 12-7 12z" fill="none" stroke="var(--brand-main)" strokeWidth="1.6" />
        </svg>
        <span className="absolute left-3 top-3 rounded-md bg-surface px-2 py-1 text-[11px] font-medium text-muted">{label}</span>
      </div>
      <figcaption className="mt-2 text-xs text-muted">{note}</figcaption>
    </figure>
  );
}
