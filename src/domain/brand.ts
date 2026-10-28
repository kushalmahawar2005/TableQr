// Adaptive brand layer (Foundation v1): an outlet gives one brand colour, and Tableeqr derives
// safe tokens from it. The brand never changes semantic colours, fonts, radius or layout.

export const DEFAULT_ACCENT = "#C9482B";

/** Buttons carry white text, so the main brand colour must reach at least this contrast */
const MIN_CONTRAST = 4.5;

export type BrandTokens = {
  main: string;
  strong: string;
  hover: string;
  pressed: string;
  soft: string;
  border: string;
  on: string;
  /** The colour as the restaurant entered it, for decorative use only */
  original: string;
  /** True when `main` had to be darkened to stay readable */
  adjusted: boolean;
};

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Mixes `a` toward `b` by `t` (0 keeps a, 1 gives b) */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colours */
export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a) ?? [0, 0, 0]);
  const lb = luminance(parseHex(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/**
 * Derives the brand tokens. A colour too light or too bright for white button text
 * (neon, pastel) is darkened just enough to pass; an invalid value falls back to the default.
 */
export function deriveBrandTokens(accent: string | null | undefined): BrandTokens {
  const original = accent && parseHex(accent) ? toHex(parseHex(accent)!) : DEFAULT_ACCENT;
  let main = parseHex(original)!;
  let adjusted = false;
  for (let i = 0; i < 40 && contrast(toHex(main), "#FFFFFF") < MIN_CONTRAST; i++) {
    main = mix(main, BLACK, 0.04);
    adjusted = true;
  }

  return {
    main: toHex(main),
    strong: toHex(mix(main, BLACK, 0.2)),
    hover: toHex(mix(main, BLACK, 0.08)),
    pressed: toHex(mix(main, BLACK, 0.16)),
    soft: toHex(mix(main, WHITE, 0.9)),
    border: toHex(mix(main, WHITE, 0.7)),
    on: "#FFFFFF",
    original,
    adjusted,
  };
}

/** The tokens as CSS custom properties, to set on a guest page's root element */
export function brandStyle(t: BrandTokens): Record<string, string> {
  return {
    "--brand-main": t.main,
    "--brand-strong": t.strong,
    "--brand-hover": t.hover,
    "--brand-pressed": t.pressed,
    "--brand-soft": t.soft,
    "--brand-border": t.border,
    "--brand-on": t.on,
  };
}
