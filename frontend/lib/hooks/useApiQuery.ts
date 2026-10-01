"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";

export type ApiQueryParams = Record<string, string | number | null | undefined>;

/**
 * GET `path` with `params`, re-fetching whenever either changes. Used by the
 * Practice Tracker's server-paginated lists.
 *
 * Keeps the previous response on screen while the next one loads
 * (`loading` is true, `data` is the old page), so paging or filtering a
 * table never flashes it empty -- it dims instead. A response that arrives
 * after a newer request was made is dropped, so a slow page 2 can never
 * overwrite page 3.
 *
 * null/undefined/"" params are left out of the query string entirely.
 * Pass `enabled: false` to hold off (e.g. until the session check is done).
 */
export function useApiQuery<T>(path: string | null, params: ApiQueryParams = {}, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  const cleanParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") cleanParams[key] = value;
  }
  const paramsKey = JSON.stringify(cleanParams);

  useEffect(() => {
    if (!enabled || !path) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .get<T>(path, { params: JSON.parse(paramsKey) })
      .then(({ data: body }) => {
        if (id === requestId.current) setData(body);
      })
      .catch((err) => {
        if (id === requestId.current) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [path, paramsKey, enabled, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return { data, error, loading, reload, setData };
}
