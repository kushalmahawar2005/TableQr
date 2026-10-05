import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
// Hindi: Hind for reading text, Poppins for headings (both carry Devanagari)
import "@fontsource/hind/400.css";
import "@fontsource/hind/500.css";
import "@fontsource/hind/600.css";
import "@fontsource/hind/700.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./globals.css";

// Fonts ship with the app (npm packages), so a production build never needs to reach Google Fonts.

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
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans text-body">
        {children}
      </body>
    </html>
  );
}
