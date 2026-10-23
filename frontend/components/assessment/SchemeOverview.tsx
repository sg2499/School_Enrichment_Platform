"use client";

/**
 * A scheme as it stands, to read (#165): for a published or replaced
 * scheme, for a teacher, and for a template a school admin starts from.
 */
import {
  ATTEMPT_RULE_LABEL,
  ATTEMPT_RULE_MEANING,
  KIND_LABEL,
  SOURCE_LABEL,
  TERM_LABEL,
} from "@/lib/assessment";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { SchemeDetail } from "@/types/assessment";

export function SchemeOverview({ scheme }: { scheme: SchemeDetail }) {
  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <CardTitle>How the Result Is Worked Out</CardTitle>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Pass Mark" value={`${scheme.passPercent}%`} />
          <Fact
            label="Practice Attempts"
            value={ATTEMPT_RULE_LABEL[scheme.attemptRule]}
            note={ATTEMPT_RULE_MEANING[scheme.attemptRule]}
          />
          <Fact label="Result Shown To" value={scheme.decimalPlaces === 1 ? "One Decimal Place" : "Whole Numbers"} />
          <Fact label="Words Used" value={`${scheme.passLabel} / ${scheme.failLabel}`} />
        </dl>
      </Card>

      <Card className="space-y-4 p-6">
        <div>
          <CardTitle>Components</CardTitle>
          <CardDescription>
            Absent counts as 0. Exempt shares that component&apos;s weight among the others.
          </CardDescription>
        </div>
        <Table caption="The scheme's components" minWidth="48rem">
          <THead>
            <TH>Component</TH>
            <TH>Term</TH>
            <TH>Marks</TH>
            <TH align="right">Out Of</TH>
            <TH align="right">Weight</TH>
            <TH align="right">Own Pass Mark</TH>
          </THead>
          <TBody>
            {scheme.components.map((c) => (
              <TR key={c.id}>
                <TD>
                  <span className="font-semibold text-content">{c.name}</span>
                  <span className="block text-content-subtle">{KIND_LABEL[c.kind]}</span>
                  {c.source === "PLATFORM" && c.activities.length > 0 ? (
                    <span className="block text-content-subtle">
                      {c.activities.map((a) => a.title ?? "Practice Set").join(", ")}
                    </span>
                  ) : null}
                </TD>
                <TD>{TERM_LABEL[c.term]}</TD>
                <TD>{SOURCE_LABEL[c.source]}</TD>
                <TD align="right">{c.maxMarks}</TD>
                <TD align="right">{c.weightPercent}%</TD>
                <TD align="right">{c.minPassPercent ? `${c.minPassPercent}%` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card className="space-y-4 p-6">
        <CardTitle>Grades</CardTitle>
        <ul className="flex flex-wrap gap-2">
          {[...scheme.gradeBands]
            .sort((a, b) => Number(b.minPercent) - Number(a.minPercent))
            .map((band) => (
              <li key={band.label} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <strong className="text-content">{band.label}</strong>{" "}
                <span className="text-content-muted">from {band.minPercent}%</span>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">{label}</dt>
      <dd className="mt-1 font-semibold text-content">{value}</dd>
      {note ? <dd className="mt-0.5 text-content-muted">{note}</dd> : null}
    </div>
  );
}
