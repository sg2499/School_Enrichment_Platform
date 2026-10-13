"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { PRODUCT_NAME } from "@/lib/brand";

/*
 * The last net (rewritten 3 Oct 2026, UI revamp Phase B, slice 2).
 *
 * Next renders this only when the root layout itself fails -- the one case
 * app/error.tsx cannot catch, because it lives inside that layout. It
 * replaces the whole document, so it has to bring its own <html> and
 * <body>. It used to render Next's stock error component: "500 | An
 * unexpected error occurred", unbranded.
 *
 * Deliberately built from nothing but inline styles and an inline SVG. If
 * the layout could not render, there is no reason to trust that the
 * stylesheet, the fonts or any shared component will either; this page must
 * still look like Krama when everything it would normally lean
 * on is the thing that broke. The colours are the brand tokens from
 * tailwind.config.ts, written out: ink #1C1B29 on paper #FAF8F4 (16:1),
 * muted #4B4962 on white (8.6:1), white on brand-700 #3C3489 (10.3:1).
 *
 * No role-specific wording: with the layout gone there is no dependable way
 * to know whose workspace this was.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const reference = typeof error?.digest === "string" && error.digest ? error.digest : null;

  return (
    <html lang="en">
      <head>
        <title>{`Something Went Wrong · ${PRODUCT_NAME}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          boxSizing: "border-box",
          background: "#FAF8F4",
          color: "#1C1B29",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "30rem",
            boxSizing: "border-box",
            padding: "40px 32px",
            textAlign: "center",
            background: "#FFFFFF",
            border: "1px solid #E8E4DB",
            borderRadius: "28px",
            boxShadow: "0 1px 2px rgba(28,27,41,0.05), 0 30px 60px -30px rgba(28,27,41,0.45)",
          }}
        >
          <svg viewBox="0 0 44 44" width="56" height="56" role="img" aria-label={PRODUCT_NAME}>
            <rect width="44" height="44" rx="13" fill="#3C3489" />
            <g fill="#FFFFFF">
              <rect x="10" y="27.5" width="8" height="4" rx="2" opacity="0.72" />
              <rect x="10" y="20" width="14.5" height="4" rx="2" opacity="0.88" />
              <rect x="10" y="12.5" width="21" height="4" rx="2" />
            </g>
            <circle cx="32.5" cy="29.5" r="4.5" fill="#F9AB2B" />
          </svg>

          <h1 style={{ margin: "24px 0 0", fontSize: "1.625rem", lineHeight: 1.2, fontWeight: 650, letterSpacing: "-0.015em", textWrap: "balance" }}>
            {PRODUCT_NAME} couldn&rsquo;t load
          </h1>
          <p style={{ margin: "12px auto 0", maxWidth: "24rem", fontSize: "1rem", lineHeight: 1.6, color: "#4B4962" }}>
            Something stopped the page from opening. Anything you had already saved is safe. Reloading usually
            puts it right.
          </p>

          {reference ? (
            <p style={{ margin: "20px 0 0", fontSize: "0.8125rem", color: "#4B4962" }}>
              Reference{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 600, color: "#1C1B29", userSelect: "all" }}>
                {reference}
              </span>
            </p>
          ) : null}

          <div style={{ marginTop: "28px", display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "44px",
                padding: "0 22px",
                border: 0,
                borderRadius: "999px",
                background: "#3C3489",
                color: "#FFFFFF",
                font: "inherit",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload the Page
            </button>
            {/* A plain link, not next/link: with the layout broken, a full
                page load is the point. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/login"
              style={{
                height: "44px",
                padding: "0 22px",
                display: "inline-flex",
                alignItems: "center",
                boxSizing: "border-box",
                border: "1px solid #D7D2C6",
                borderRadius: "999px",
                background: "#FFFFFF",
                color: "#1C1B29",
                fontSize: "0.9375rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to Sign In
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
