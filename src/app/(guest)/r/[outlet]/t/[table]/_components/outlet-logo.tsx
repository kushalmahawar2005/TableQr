/** The restaurant's logo, or the first letter of its name when it has none */
export function OutletLogo({ name, logoUrl, size = 44 }: { name: string; logoUrl: string | null; size?: 40 | 44 | 80 }) {
  const box = size === 40 ? "size-10" : size === 80 ? "size-20 text-title" : "size-11";
  return logoUrl ? (
    // Restaurant uploads can live on any host, so this stays a plain image
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" width={size} height={size} className={`${box} shrink-0 rounded-card bg-surface object-contain`} />
  ) : (
    <span
      aria-hidden
      className={`grid ${box} shrink-0 place-items-center rounded-card border border-brand-border bg-brand-soft font-display text-section font-bold text-brand-strong`}
    >
      {Array.from(name.trim())[0]?.toUpperCase()}
    </span>
  );
}
