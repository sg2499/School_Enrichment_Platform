"use client";

/**
 * One section's results under a scheme (#165), as the server works them
 * out: each component's marks, the result, grade and outcome, and why a
 * result is provisional. Downloads as a spreadsheet.
 */
import { Download } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { RESULT_STATUS_LABEL, formatResult, resultsCsv } from "@/lib/assessment";
import { LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { downloadText, fileNameFor } from "@/components/assessment/common";
import type { ResultComponentCell, SchemeResults } from "@/types/assessment";

export function ResultsTable({
  schemeId,
  section,
  decimalPlaces,
}: {
  schemeId: string;
  section: string;
  /** The scheme's, so "91" shows as "91.0" in a one-decimal scheme. */
  decimalPlaces: number;
}) {
  const results = useApiQuery<SchemeResults>(
    `/assessment/schemes/${schemeId}/results`,
    { section },
    { action: "work out these results" },
  );
  const data = results.problem ? null : results.data;

  if (results.problem) return <LoadError problem={results.problem} onRetry={results.reload} />;
  if (!data) return <TableSkeleton label="Working out results" />;
  if (data.rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-content-muted">
        No students are in section {section} of this class yet.
      </p>
    );
  }

  const passed = data.rows.filter((r) => r.outcome === "PASS").length;
  const below = data.rows.filter((r) => r.outcome === "BELOW_PASS").length;
  const provisional = data.rows.filter((r) => r.provisional).length;

  function download() {
    if (!data) return;
    const name = fileNameFor(data.scheme.name, "Section", section, "Results");
    downloadText(`${name || "Results"}.csv`, resultsCsv(data.components, data.rows, decimalPlaces));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-content">
          <strong>{data.rows.length}</strong> students · <strong>{passed}</strong> passing ·{" "}
          <strong>{below}</strong> below the pass mark
          {provisional > 0 ? (
            <>
              {" "}
              · <strong>{provisional}</strong> provisional
            </>
          ) : null}
        </p>
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
          onClick={download}
        >
          Download Spreadsheet
        </Button>
      </div>
      {provisional > 0 ? (
        <p className="text-sm text-content-muted">
          A result is provisional while marks are missing or an answer is still waiting to be marked.
        </p>
      ) : null}
      <Table
        caption={`Results for section ${section}`}
        minWidth={`${Math.max(44, 26 + data.components.length * 9)}rem`}
        busy={results.loading}
      >
        <THead>
          <TH>Student</TH>
          {data.components.map((c) => (
            <TH key={c.id} align="right">
              {c.name}
              <span className="block font-medium normal-case tracking-normal">
                /{c.maxMarks} · {c.weightPercent}%
              </span>
            </TH>
          ))}
          <TH align="right">Result</TH>
          <TH>Grade</TH>
          <TH>Outcome</TH>
        </THead>
        <TBody>
          {data.rows.map((row) => {
            const byId = new Map(row.components.map((c) => [c.componentId, c]));
            return (
              <TR key={row.studentId}>
                <TD className="whitespace-nowrap">
                  <span className="font-semibold text-content">{row.studentName ?? "—"}</span>
                  <span className="block text-content-subtle">{row.studentCode}</span>
                </TD>
                {data.components.map((c) => (
                  <TD key={c.id} align="right">
                    <Cell cell={byId.get(c.id)} />
                  </TD>
                ))}
                <TD align="right">
                  {row.result !== null ? (
                    <strong className="text-content">{formatResult(row.result, decimalPlaces)}%</strong>
                  ) : (
                    "—"
                  )}
                  {row.provisional ? (
                    <span className="mt-1 block">
                      <Badge tone="warning" size="sm">
                        Provisional
                      </Badge>
                    </span>
                  ) : null}
                </TD>
                <TD>{row.grade ?? "—"}</TD>
                <TD>
                  {row.outcome === null ? (
                    <span className="text-content-subtle">—</span>
                  ) : (
                    <Badge tone={row.outcome === "PASS" ? "success" : "danger"} size="sm">
                      {row.outcomeLabel}
                    </Badge>
                  )}
                  {row.notes.map((note) => (
                    <span key={note} className="mt-1 block max-w-56 text-xs text-content-muted">
                      {note}
                    </span>
                  ))}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

function Cell({ cell }: { cell: ResultComponentCell | undefined }) {
  if (!cell) return <span className="text-content-subtle">—</span>;
  const shortfall = cell.meetsOwnMinimum === false;
  return (
    <span className="inline-flex flex-col items-end">
      {cell.status === "MARKS" ? (
        <span className={shortfall ? "font-semibold text-coral-700" : "text-content"}>{cell.marks}</span>
      ) : cell.status === "MISSING" ? (
        <span className="text-content-subtle">{RESULT_STATUS_LABEL.MISSING}</span>
      ) : (
        <span className="text-content-muted">{RESULT_STATUS_LABEL[cell.status]}</span>
      )}
      {shortfall ? <span className="text-xs text-coral-700">Below its pass mark</span> : null}
      {cell.pendingReview ? <span className="text-xs text-saffron-800">Waiting to be marked</span> : null}
    </span>
  );
}
