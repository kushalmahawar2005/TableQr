"use client";
import { useState } from "react";
import { menuThumb } from "@/domain/menu-photo";

/** The restaurant's logo, or the first letter of its name when it has none */
export function OutletLogo({ name, logoUrl, size = 44 }: { name: string; logoUrl: string | null; size?: 40 | 44 | 80 }) {
  const box = size === 40 ? "size-10" : size === 80 ? "size-20 text-title" : "size-11";
  const letterSize = size === 80 ? "text-2xl" : "text-lg";
  // The 480 px copy is plenty for a 44-80 px logo; older uploads without one fall back to the full image
  const [smallFailed, setSmallFailed] = useState(false);
  const src = smallFailed ? logoUrl : menuThumb(logoUrl);
  return src ? (
    // Restaurant uploads can live on any host, so this stays a plain image
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} onError={() => src !== logoUrl && setSmallFailed(true)} className={`${box} shrink-0 rounded-card object-contain`} />
  ) : (
    <span
      aria-hidden
      className={`grid ${box} ${letterSize} shrink-0 place-items-center rounded-card border border-brand-border bg-brand-soft font-sans font-extrabold tracking-tight text-brand-strong`}
    >
      {Array.from(name.trim())[0]?.toUpperCase()}
    </span>
  );
}
