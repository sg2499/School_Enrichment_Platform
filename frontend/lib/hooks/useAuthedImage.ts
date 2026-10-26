"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * An image the server only gives to a signed-in person (a profile photo, a
 * school's logo): fetched with the session, shown from a local object URL.
 * Null until it has loaded, and on any failure, so a caller can fall back
 * to something else instead of a broken-image icon.
 */
export function useAuthedImage(url: string | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    // The url starts "/api/..."; `api` already adds the "/api".
    const path = url.startsWith("/api/") ? url.slice(4) : url;
    api
      .get(path, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelled) return;
        made = URL.createObjectURL(data as Blob);
        setObjectUrl(made);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null);
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return objectUrl;
}
