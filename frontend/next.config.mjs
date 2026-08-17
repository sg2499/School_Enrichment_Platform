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
