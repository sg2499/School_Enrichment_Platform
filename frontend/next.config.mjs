import { withSentryConfig } from "@sentry/nextjs";

// Retained from MathPath's next.config.mjs (Phase 0 audit, "Retain as-is"
// bucket). httpOnly session cookies only work as first-party cookies. The
// frontend (Vercel) and backend (Render) are on different domains, so
// without this rewrite a cookie set by the backend would be third-party
// from the browser's point of view -- Safari/iOS block those by default,
// silently breaking login for exactly that slice of users. This rewrite
// makes every /api/* call same-origin (the browser only ever talks to its
// own domain; Vercel proxies the request to Render server-side), so the
// cookie is first-party and can use SameSite=Lax instead of the cross-site
// None. Works in `next dev` too, provided BACKEND_ORIGIN (or
// NEXT_PUBLIC_API_BASE_URL) points at the local backend.
function resolveBackendOrigin() {
  const raw = (process.env.BACKEND_ORIGIN || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000")
    .trim()
    .replace(/\/+$/, "");
  return raw.endsWith("/api") ? raw.slice(0, -4) : raw;
}

// Content-Security-Policy (2026-08-19 security hardening -- previously
// absent entirely, flagged as a concrete gap in the security audit).
//
// script-src includes 'unsafe-inline': Next.js's App Router streams Server
// Component payloads to the client via inline `<script>self.__next_f.push(...)`
// tags injected into the HTML itself (not something this app's own code
// does), so a strict `script-src 'self'` with no exception breaks
// hydration on every page. The fully strict alternative is a per-request
// nonce threaded through `middleware.ts` and every layout -- a real
// improvement worth doing later, but it changes rendering behavior on
// every route and needs to be verified against a live, rendered page
// before shipping; this sandbox has no working live-browser path (see the
// responsive-audit changelog entry above), so it is not being done blind
// here. What this CSP still meaningfully stops: loading any script from a
// domain other than this app's own origin -- the actual common attack
// shape (a compromised third-party script, an injected remote `<script
// src>`), even though it doesn't stop an inline-script XSS payload if one
// were otherwise achievable. style-src needs 'unsafe-inline' for the same
// class of reason -- this codebase sets inline styles both via React's
// `style={{...}}` (components/brand/Graphics.tsx) and via direct
// `element.style.setProperty()` (login page's pointer-ambience effect) --
// style-based injection is a much narrower vector than script-based, so
// this is the standard, accepted trade-off.
//
// 'unsafe-eval' is added to script-src only outside production: Next's dev
// server / webpack HMR needs `eval` to work at all locally, but a
// production build never does.
function buildCsp() {
  const isProd = process.env.NODE_ENV === "production";
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"])],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    // data: for base64 profile photos and server-generated 2FA QR codes
    // (see backend/app/core/totp.py's totp_qr_code_data_url()); blob: for
    // the backup-codes .txt download link (URL.createObjectURL).
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'", "https://*.sentry.io", "https://*.ingest.sentry.io"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
  };
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${resolveBackendOrigin()}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      // RFC 9116 recommends /.well-known/security.txt as the canonical
      // location (that's where the real file lives, in public/), but some
      // older scanners still only check the bare root path -- redirect
      // rather than duplicating the file in two places.
      {
        source: "/security.txt",
        destination: "/.well-known/security.txt",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: buildCsp() },
        ],
      },
    ];
  },
};

// Sentry wrapping is safe to leave in even before a School Enrichment
// Sentry project exists -- with no SENTRY_DSN/auth token configured, the
// SDK simply doesn't report anything, and errorHandler below stops a
// Sentry-side hiccup from ever failing a build that otherwise succeeded.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG || "zetta-metrics",
  project: process.env.SENTRY_PROJECT || "school-enrichment-frontend",
  widenClientFileUpload: true,
  disableLogger: true,
  errorHandler: (error) => {
    console.warn("[sentry] build-time step failed, continuing anyway:", error);
  },
});
