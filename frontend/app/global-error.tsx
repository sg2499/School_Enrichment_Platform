"use client";

// Retained from MathPath's app/global-error.tsx (Phase 0 audit, "Retain
// as-is" bucket) -- reports uncaught React rendering errors to Sentry.
import * as Sentry from "@sentry/nextjs";
import Error from "next/error";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <Error statusCode={500} title="An unexpected error occurred" />
      </body>
    </html>
  );
}
