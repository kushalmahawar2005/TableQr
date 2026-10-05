"use client";

import { Moon, Sun } from "lucide-react";

export const THEME_COOKIE = "tq_theme";

/** Remember the choice for a year. Read on the server so the page renders in the right theme without a flash. */
export function saveTheme(dark: boolean) {
  document.cookie = `${THEME_COOKIE}=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle({ dark, onChange, className = "", showLabel = false }: { dark: boolean; onChange: (dark: boolean) => void; className?: string; showLabel?: boolean }) {
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label={label} title={label} onClick={() => { saveTheme(!dark); onChange(!dark); }} className={className}>
      {dark ? <Sun className="size-5 shrink-0" aria-hidden="true" /> : <Moon className="size-5 shrink-0" aria-hidden="true" />}
      {showLabel && <span className="truncate">{dark ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}
