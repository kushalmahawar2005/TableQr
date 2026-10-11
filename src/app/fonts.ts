import localFont from "next/font/local";

// Self-hosted fonts through next/font, so the page preloads them and shows a size-matched fallback
// while they arrive (no layout jump), with no call to Google Fonts at build time.
//
// The latin files cover English text. The ₹ sign lives in the much larger latin-ext file (85 KB for
// Inter), so a 1 KB cut holding only ₹ (made from the same font with fonttools) comes first in the
// stack: its unicode-range means it is fetched only on pages that show a price, and used only for ₹.

// next/font needs literal option values, so the ranges are written out in each call below.
// LATIN: fontsource's latin range. RUPEE: U+20B9.

export const interLatin = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--nf-inter",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const interRupee = localFont({
  src: "./fonts/inter-rupee.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--nf-inter-rupee",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+20B9" }],
});

export const manropeLatin = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--nf-manrope",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const manropeRupee = localFont({
  src: "./fonts/manrope-rupee.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--nf-manrope-rupee",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+20B9" }],
});

export const fontVariables = [interLatin, interRupee, manropeLatin, manropeRupee].map((f) => f.variable).join(" ");
