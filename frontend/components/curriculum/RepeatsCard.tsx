"use client";

/**
 * The repeated questions of one chapter (#234, 18 Nov 2026). A repeat has the
 * same wording, options and answer as an earlier question in the chapter. It
 * stays in the bank, but it is left out of practice sets and of bulk approval,
 * so a child never meets the same question twice. "Check again" finds the
 * repeats afresh after content was changed.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { ErrorBanner } from "@/components/curriculum/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { api, errorMessage } from "@/lib/api";
import type { ChapterRepeats } from "@/types/curriculum";
import { MathText } from "@/components/ui/MathText";

const SHOWN = 40;

export function RepeatsCard({ chapterId, onChanged }: { chapterId: string; onChanged?: () => Promise<void> | void }) {
  const [data, setData] = useState<ChapterRepeats | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get<ChapterRepeats>(`/curriculum-admin/chapters/${chapterId}/repeats`);
      setData(body);
      setProblem(null);
    } catch (err) {
      setProblem(errorMessage(err, "load the repeated questions"));
    }
  }, [chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scan() {
    setBusy(true);
    try {
      const { data: body } = await api.post<ChapterRepeats>(`/curriculum-admin/chapters/${chapterId}/repeats/scan`);
      setData(body);
      setProblem(null);
      await onChanged?.();
    } catch (err) {
      setProblem(errorMessage(err, "check for repeated questions"));
    } finally {
      setBusy(false);
    }
  }

  const shown = data ? (all ? data.repeats : data.repeats.slice(0, SHOWN)) : [];
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1.5">
        <CardTitle className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-brand-600" aria-hidden />
          Repeated Questions{data ? `: ${data.count}` : ""}
        </CardTitle>
        <CardDescription>
          Same wording, options and answer as an earlier question in this chapter. They stay in the bank, but are left out of practice
          sets and of bulk approval.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {problem ? <ErrorBanner message={problem} /> : null}
        {data && data.count === 0 ? <p className="text-sm text-content-muted">No repeats found in this chapter.</p> : null}
        {shown.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {shown.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <p className="font-medium text-content"><MathText>{r.stem}</MathText></p>
                <p className="mt-0.5 text-xs text-content-muted">
                  {r.code} repeats {r.keptCode ?? "an earlier question"} · answer {r.correctAnswer}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {data && data.count > SHOWN ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${data.count}`}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void scan()}
          disabled={busy}
          leadingIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
        >
          {busy ? "Checking…" : "Check Again"}
        </Button>
      </CardBody>
    </Card>
  );
}
