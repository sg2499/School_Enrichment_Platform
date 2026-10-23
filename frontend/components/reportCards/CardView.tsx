"use client";

/**
 * A report card on screen, exactly as issued (#188): the same figures the
 * PDF prints. Used by the student's Report Card page and by staff opening
 * one student's card.
 */
import { markText, percentText, RECORD_TERM_LABEL } from "@/lib/reportCards";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { dayText } from "@/components/reportCards/common";
import type { RecordTerm, ReportCardData } from "@/types/reportCards";

export function CardView({ card }: { card: ReportCardData }) {
  const yearEnd = card.cardTerm === "YEAR_END";
  const terms: RecordTerm[] = yearEnd ? ["TERM_1", "TERM_2"] : ["TERM_1"];
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="font-display text-xl font-semibold text-content">{card.school.name}</p>
        {card.school.city ? <p className="text-sm text-content-muted">{card.school.city}</p> : null}
        <p className="mt-2 font-semibold text-content">
          {card.title}, {card.year}
        </p>
      </div>

      <dl className="grid gap-3 rounded-2xl bg-surface-muted p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Student" value={card.student.name} />
        <Fact label="Student Code" value={card.student.code} />
        <Fact label="Class" value={`${card.student.classLevel}, Section ${card.student.section}`} />
        <Fact label="Date of Birth" value={card.student.dob || "—"} />
      </dl>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-content">Scholastic Areas</h3>
        {card.subjects.map((subject, subjectIndex) => (
          <div key={subjectIndex} className="space-y-1">
            <Table caption={`${subject.subject} on this card`} minWidth={`${Math.max(36, 20 + subject.components.length * 8)}rem`}>
              <THead>
                <TH>Subject</TH>
                {subject.components.map((c, i) => (
                  <TH key={i} align="right">
                    {c.name}
                    <span className="block font-medium normal-case tracking-normal">out of {c.maxMarks}</span>
                  </TH>
                ))}
                {yearEnd
                  ? terms
                      .filter((t) => subject.terms?.[t])
                      .map((t) => (
                        <TH key={t} align="right">
                          {RECORD_TERM_LABEL[t]}
                        </TH>
                      ))
                  : null}
                <TH align="right">{yearEnd ? "Year" : "Result"}</TH>
                <TH>Grade</TH>
                <TH>Outcome</TH>
              </THead>
              <TBody>
                <TR>
                  <TD className="font-semibold text-content">{subject.subject}</TD>
                  {subject.components.map((c, i) => (
                    <TD key={i} align="right">
                      {markText(c.status, c.marks)}
                    </TD>
                  ))}
                  {yearEnd
                    ? terms
                        .filter((t) => subject.terms?.[t])
                        .map((t) => (
                          <TD key={t} align="right">
                            {percentText(subject.terms?.[t]?.result)}
                          </TD>
                        ))
                    : null}
                  <TD align="right">
                    <strong className="text-content">{percentText(subject.result)}</strong>
                  </TD>
                  <TD>{subject.grade ?? "—"}</TD>
                  <TD>
                    {subject.outcome ? (
                      <Badge tone={subject.outcome === "PASS" ? "success" : "danger"} size="sm">
                        {subject.outcomeLabel}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TD>
                </TR>
              </TBody>
            </Table>
            {subject.notes.length > 0 ? <p className="text-xs text-content-muted">{subject.notes.join(" ")}</p> : null}
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-content">Co-Scholastic Areas</h3>
          <Table caption="Co-scholastic grades" minWidth="18rem">
            <THead>
              <TH>Area</TH>
              {terms.map((t) => (
                <TH key={t}>{RECORD_TERM_LABEL[t]}</TH>
              ))}
            </THead>
            <TBody>
              {card.coScholastic.areas.map((area) => (
                <TR key={area}>
                  <TD>{area}</TD>
                  {terms.map((t) => (
                    <TD key={t}>{card.coScholastic.grades[t]?.[area] ?? "—"}</TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-xs text-content-muted">
            {card.coScholastic.scale.map((s) => `${s.label} ${s.meaning}`.trim()).join("; ")}
          </p>
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-content">Attendance</h3>
          <Table caption="Attendance" minWidth="18rem">
            <THead>
              <TH>Term</TH>
              <TH align="right">Days Present</TH>
              <TH align="right">Working Days</TH>
            </THead>
            <TBody>
              {terms.map((t) => (
                <TR key={t}>
                  <TD>{RECORD_TERM_LABEL[t]}</TD>
                  <TD align="right">{card.attendance[t]?.daysPresent ?? "—"}</TD>
                  <TD align="right">{card.attendance[t]?.workingDays ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-content">Class Teacher&apos;s Remark</h3>
        <p className="text-sm text-content">{card.remark || "—"}</p>
      </section>
      {card.issuedAt ? <p className="text-xs text-content-muted">Issued on {dayText(card.issuedAt)}.</p> : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">{label}</dt>
      <dd className="mt-1 font-semibold text-content">{value}</dd>
    </div>
  );
}
