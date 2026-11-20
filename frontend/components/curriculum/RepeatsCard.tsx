"use client";

/**
 * The repeated questions of one chapter (#234, 18 Nov 2026). A repeat has the
 * same wording, options and answer as an earlier question in the chapter. It
 * stays in the bank, but it is left out of practice sets and of bulk approval,
 * so a child never meets the same question twice. "Check again" finds the
 * repeats afresh after content was changed.
 *
 * Shut by default (20 Nov 2026): a chapter can have hundreds, and a list that
 * long pushed everything else on the Overview off the screen. The card says
 * how many there are; "Show Repeats" opens a scrolling table of them.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { ErrorBanner } from "@/components/curriculum/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardTitle } from "@/components/ui/Card";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChapterRepeats } from "@/types/curriculum";
import { MathText } from "@/components/ui/MathText";

export function RepeatsCard({ chapterId, onChanged }: { chapterId: string; onChanged?: () => Promise<void> | void }) {
  const [data, setData] = useState<ChapterRepeats | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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

  const count = data?.count ?? 0;
  const panelId = `repeats-${chapterId}`;
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            <CardTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-brand-600" aria-hidden />
              Repeated Questions
              {data ? (
                <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-bold text-ink-700 tabular">{count}</span>
              ) : null}
            </CardTitle>
            <CardDescription>
              {data && count === 0
                ? "No repeats found in this chapter."
                : "Same wording, options and answer as an earlier question in this chapter. They stay in the bank, but are left out of practice sets and of bulk approval."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {count > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-expanded={open}
                aria-controls={panelId}
                trailingIcon={<ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Hide Repeats" : "Show Repeats"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void scan()}
              disabled={busy}
              leadingIcon={<RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />}
            >
              {busy ? "Checking…" : "Check Again"}
            </Button>
          </div>
        </div>

        {problem ? <ErrorBanner message={problem} /> : null}

        {open && data && count > 0 ? (
          <div id={panelId} className="max-h-[28rem] overflow-auto rounded-2xl border border-line">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="sr-only">Repeated questions in this chapter</caption>
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                  <th scope="col" className="px-4 py-2.5">Question</th>
                  <th scope="col" className="w-40 px-4 py-2.5">Repeat</th>
                  <th scope="col" className="w-40 px-4 py-2.5">Repeats</th>
                  <th scope="col" className="w-28 px-4 py-2.5">Answer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.repeats.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5 font-medium text-content">
                      <MathText>{r.stem}</MathText>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-content-muted tabular">{r.code}</td>
                    <td className="px-4 py-2.5 text-xs text-content-muted tabular">{r.keptCode ?? "An earlier question"}</td>
                    <td className="px-4 py-2.5 text-content tabular">{r.correctAnswer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
