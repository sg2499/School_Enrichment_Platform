import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PRODUCT_NAME } from "@/lib/pageTitle";

// B9 fix (30 Sep 2026 security/DPDP review): previously loaded from a
// fonts.googleapis.com/fonts.gstatic.com <link> in <head> below -- every
// visitor's browser made a direct, unauthenticated request to Google for
// those assets before this app rendered anything, which both leaks visitor
// IPs/user-agents to a third party on every page load (a DPDP-relevant
// exposure for what may be a child's device) and adds a render-blocking
// third-party round trip. next/font/google downloads the font files at
// BUILD time and self-hosts them from this app's own origin -- no runtime
// request to Google ever happens, and the CSP's font-src 'self' (already
// tightened for this reason, see next.config.js) is what actually stops it
// now instead of just documenting an exception for it.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  // One format for every tab: "Page · Role · School Enrichment"
  // (lib/pageTitle.ts). The template covers the few routes that set a plain
  // title here on the server; signed-in pages title themselves in the
  // browser, where the role is known.
  title: {
    default: PRODUCT_NAME,
    template: `%s \u00b7 ${PRODUCT_NAME}`,
  },
  description: "CBSE/ICSE academic learning platform",
  applicationName: PRODUCT_NAME,
  icons: {
    // Inline SVG favicon -- keeps the brand mark in the tab without adding a
    // binary asset or an external request.
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#26215C"/><path d="M9 21.5h5.2v3H9zM9 15.5h9.5v3H9zM9 9.5h14v3H9z" fill="#fff"/><circle cx="24" cy="22" r="3" fill="#F9AB2B"/></svg>',
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#26215C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${plusJakartaSans.variable} ${fraunces.variable}`}>
      {/* suppressHydrationWarning here only silences mismatches on this exact
          tag -- it's the standard Next.js fix for browser extensions (e.g.
          Grammarly, translators) that inject attributes into <body> before
          React hydrates. It does not suppress real hydration bugs elsewhere
          in the tree. */}
      <body className="min-h-full bg-canvas font-sans text-content antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
