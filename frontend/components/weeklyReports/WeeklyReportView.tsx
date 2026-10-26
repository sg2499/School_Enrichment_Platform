"use client";

/**
 * One child's weekly page on screen (#187): the same content the PDF
 * prints. Used by the student's Weekly Report page and by staff previewing
 * or opening a child's page.
 */
import { scoreText, shortDay, STATUS_TONE } from "@/lib/weeklyReports";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { dayText } from "@/components/reportCards/common";
import type { WeeklyReportData, WeeklySkill } from "@/types/weeklyReports";
import { SchoolLogo, useSchoolLogoUrl } from "@/components/school/SchoolLogo";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-muted p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular text-content">
        {value}
      </dd>
    </div>
  );
}

function SkillList({
  title,
  skills,
  empty,
}: {
  title: string;
  skills: WeeklySkill[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold text-content">{title}</h4>
      {skills.length === 0 ? (
        <p className="text-sm text-content-muted">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm text-content">
          {skills.map((s) => (
            <li key={`${s.chapterNo}-${s.title}`}>
              {s.title}{" "}
              <span className="text-content-subtle">
                ({s.chapterNo ? `Chapter ${s.chapterNo}` : s.chapter}
                {s.percent !== null ? `, ${s.percent}%` : ""})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WeeklyReportView({
  report,
  draft = false,
}: {
  report: WeeklyReportData;
  draft?: boolean;
}) {
  // The viewer's own school: the only one whose reports they can open.
  const logo = useSchoolLogoUrl(report.school.logoUrl);
  const t = report.totals;
  const n = report.weekNumbers;
  const extra = [
    t.late ? `${t.late} done late` : null,
    t.notDone ? `${t.notDone} not done` : null,
    t.open ? `${t.open} still open` : null,
    n.ownPractice
      ? `also practised on their own: ${n.ownPractice} ${n.ownPractice === 1 ? "set" : "sets"}`
      : null,
  ].filter(Boolean);
  return (
    <div className="space-y-6">
      <div className="text-center">
        {logo ? (
          <div className="mb-3 flex justify-center">
            <SchoolLogo
              url={logo}
              schoolName={report.school.name}
              decorative
              className="h-14 max-w-[12rem]"
              tileClassName="p-2"
            />
          </div>
        ) : null}
        <p className="font-display text-xl font-semibold text-content">
          {report.school.name}
        </p>
        {report.school.city ? (
          <p className="text-sm text-content-muted">{report.school.city}</p>
        ) : null}
        <p className="mt-2 font-semibold text-content">{report.title}</p>
        <p className="text-sm text-content-muted">
          Week of {report.week.label}
        </p>
      </div>

      <dl className="grid gap-3 rounded-2xl bg-surface-muted p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Student" value={report.student.name} />
        <Fact label="Student Code" value={report.student.code} />
        <Fact label="Class" value={report.student.classLevel} />
        <Fact label="Section" value={report.student.section} />
      </dl>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-content">
          This Week&apos;s Practice
        </h3>
        {report.sets.length === 0 ? (
          <p className="text-sm text-content-muted">
            No practice was set for this week.
          </p>
        ) : (
          <Table caption="The practice set for this week" minWidth="36rem">
            <THead>
              <TH>Practice Set</TH>
              <TH>Subject</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH align="right">Score</TH>
            </THead>
            <TBody>
              {report.sets.map((s, i) => (
                <TR key={i}>
                  <TD>
                    <span className="font-semibold text-content">
                      {s.title}
                    </span>
                  </TD>
                  <TD>{s.subject ?? "—"}</TD>
                  <TD className="whitespace-nowrap">{shortDay(s.dueDate)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[s.status]}>{s.statusLabel}</Badge>
                  </TD>
                  <TD align="right" className="whitespace-nowrap tabular">
                    {scoreText(s.score, s.possible, s.marksToCome)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-content">The Week in Numbers</h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Sets Done"
            value={t.given ? `${t.done} of ${t.given}` : "—"}
          />
          <Tile label="Done on Time" value={t.given ? String(t.onTime) : "—"} />
          <Tile label="Questions Answered" value={String(n.answered)} />
          <Tile
            label="Marks Earned"
            value={n.percent !== null ? `${n.percent}%` : "—"}
          />
        </dl>
        {extra.length ? (
          <p className="text-xs text-content-subtle">
            {extra.join("; ").replace(/^./, (c) => c.toUpperCase())}.
          </p>
        ) : null}
      </section>

      {report.skills ? (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-content">Skills</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <SkillList
              title="Strong Skills"
              skills={report.skills.strong}
              empty="None yet: a skill shows here at 80% or more, from 3 or more answers."
            />
            <SkillList
              title="Skills to Work On"
              skills={report.skills.workOn}
              empty="Nothing to work on right now."
            />
          </div>
          <p className="text-xs text-content-subtle">
            Skills are judged on the practice handed in up to the end of this
            week, the most recent answer to each question counting.
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-bold text-content">From the Teacher</h3>
        {report.notes.section || report.notes.child ? (
          <>
            {report.notes.section ? (
              <p className="text-sm text-content">{report.notes.section}</p>
            ) : null}
            {report.notes.child ? (
              <p className="text-sm text-content">{report.notes.child}</p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-content-muted">—</p>
        )}
      </section>

      <p className="text-xs text-content-subtle">
        These marks come from practice, to help learning; they are not exam
        marks.{" "}
        {draft
          ? "This is a preview: statuses and marks are as of now, and the page is kept as it is on the day the week is issued."
          : `Issued on ${dayText(report.issuedAt)}${report.issuedBy ? ` by ${report.issuedBy}` : ""}; statuses and marks are as on that day.`}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
        {label}
      </dt>
      <dd className="font-semibold text-content">{value}</dd>
    </div>
  );
}
