import type { Metadata, Viewport } from "next";
// Hindi: Hind for reading text, Poppins for headings (both carry Devanagari)
import "@fontsource/hind/400.css";
import "@fontsource/hind/500.css";
import "@fontsource/hind/600.css";
import "@fontsource/hind/700.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import { fontVariables } from "./fonts";
import "./globals.css";

// Fonts ship with the app (see fonts.ts), so a production build never needs to reach Google Fonts.

export const metadata: Metadata = {
  title: {
    default: "TableQR",
    template: "%s | TableQR",
  },
  description: "QR table booking, ordering and billing for restaurants.",
};

export const viewport: Viewport = {
  themeColor: "#fbf8f3",
  colorScheme: "only light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Extensions such as Dark Reader add attributes to <html> before React loads
    <html
      suppressHydrationWarning
      lang="en"
      className={`h-full antialiased ${fontVariables}`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans text-body">
        {children}
      </body>
    </html>
  );
}
