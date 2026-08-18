import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "School Enrichment",
    template: "%s | School Enrichment",
  },
  description: "CBSE/ICSE academic learning platform",
  applicationName: "School Enrichment",
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
    <html lang="en" className="h-full">
      <head>
        {/* Google Fonts is the only external dependency in the visual layer.
            Loaded as a stylesheet link (rather than next/font) so builds and
            CI never depend on egress to fonts.gstatic.com; system fallbacks
            in globals.css cover the offline case. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Plus+Jakarta+Sans:wght@400..800&display=swap"
        />
      </head>
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
