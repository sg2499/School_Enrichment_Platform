import axios from "axios";
import { clearSession, getActiveRoleHeaderValue, getCsrfToken } from "./auth";

// Retained from MathPath's lib/api.ts (Phase 0 audit, "Retain as-is"
// bucket). Relative, same-origin base URL -- the actual backend is reached
// via the Next.js rewrite in next.config.mjs, which proxies /api/* to the
// real Render URL server-side. The browser itself never makes a
// cross-origin request, which is what lets the session cookie be
// first-party (SameSite=Lax) instead of needing the cross-site None that
// Safari/iOS block by default.
const DEFAULT_API_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || "90000");

export const api = axios.create({
  baseURL: "/api",
  timeout: DEFAULT_API_TIMEOUT_MS,
  // Session lives in an httpOnly cookie (see backend/app/core/cookies.py)
  // instead of a token read out of localStorage -- withCredentials is what
  // makes the browser actually attach it on every request.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const requestConfig = config as typeof config & { skipAuth?: boolean };
  if (requestConfig.skipAuth) {
    return config;
  }

  if (!config.headers) {
    config.headers = {} as typeof config.headers;
  }

  // Non-secret hint telling the backend which role's session cookie applies
  // to this request (a person can be logged into admin/teacher/student at
  // once in different tabs). Only set if a call site hasn't already
  // provided an explicit override.
  if (!config.headers["X-Auth-Role"] && !config.headers["x-auth-role"]) {
    const roleHint = getActiveRoleHeaderValue();
    if (roleHint) config.headers["X-Auth-Role"] = roleHint;
  }

  // CSRF double-submit token, required on every mutating request once a
  // cookie session exists. Harmless no-op before login (no cookie yet).
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch", "delete"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Requests made with responseType: "blob" get their ERROR responses
    // parsed as a Blob too -- axios honors the request's responseType even
    // on failure, so a JSON error body the backend sent arrives as an
    // opaque Blob instead of parsed JSON. Re-hydrate it into real JSON
    // here, once, for every caller.
    if (typeof Blob !== "undefined" && error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        error.response.data = JSON.parse(text);
      } catch {
        // Not JSON -- leave as-is.
      }
    }

    const status = error?.response?.status;
    const code = error?.response?.data?.detail?.code;
    // A CSRF 403 means the browser's CSRF cookie is missing or stale.
    // Treat it the same as a 401: clear the stale client-side session so
    // the next protected-page check sends the user to a real login, which
    // re-establishes both cookies.
    if ((status === 401 || (status === 403 && code === "CSRF_VALIDATION_FAILED")) && typeof window !== "undefined") {
      clearSession();
    }
    // Defense in depth for mandatory 2FA (backend/app/dependencies.py):
    // useProtectedPage already redirects an unenrolled admin to the setup
    // screen on page load, but a request made *during* that same session
    // (e.g. a background call still in flight, or an already-open tab) can
    // still hit this 403 first. Route it to the same place rather than
    // surfacing a raw "Two-factor authentication must be set up" error on
    // an unrelated screen.
    if (
      status === 403 &&
      code === "TWO_FACTOR_SETUP_REQUIRED" &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/admin/security")
    ) {
      window.location.href = "/admin/security?setup=required";
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;
    const detail = data?.detail;
    const detailMessage = typeof detail === "string" ? detail : detail?.message;
    const detailCode = typeof detail === "object" ? detail?.code : undefined;
    const errorMessage = data?.error?.message || data?.message || detailMessage;
    if (errorMessage && detailCode) return `${errorMessage} (${detailCode})`;
    if (error.code === "ECONNABORTED") {
      return "The server is taking longer than expected. Please wait a moment and try again.";
    }
    if (!error.response && error.message === "Network Error") {
      return "The server is temporarily unreachable. Please wait a moment and try again.";
    }
    return errorMessage || error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
