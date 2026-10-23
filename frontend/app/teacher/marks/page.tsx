"use client";

/**
 * Marks & Results (#165): the published Assessment Schemes for the classes
 * and subjects a teacher teaches, for one school year. Each opens to its
 * marks sheet and results.
 */
import { Suspense } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadError } from "@/components/ui/AlertBanner";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/Field";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { SchemeStatusBadge } from "@/components/assessment/common";
import type { AcademicYear, SchemeSummary } from "@/types/assessment";

function MarksPage() {
  const session = useProtectedPage("TEACHER");
  const { user, status } = session;
  const ready = status === "ready" && Boolean(user);
  const url = useUrlState();

  const years = useApiQuery<{ years: AcademicYear[] }>(ready ? "/assessment/years" : null, {}, {
    action: "load the school years",
  });
  const yearList = years.problem ? null : (years.data?.years ?? null);
  const year =
    yearList?.find((y) => y.id === url.get("year")) ?? yearList?.find((y) => y.isCurrent) ?? yearList?.[0] ?? null;
  const schemes = useApiQuery<{ schemes: SchemeSummary[] }>(
    ready && year ? "/assessment/schemes" : null,
    { yearId: year?.id },
    { action: "load your schemes" },
  );
  const schemeList = schemes.problem ? null : (schemes.data?.schemes ?? null);

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  return (
    <RoleShell role="TEACHER" user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Teaching Workspace"
          title="Marks & Results"
          description="Enter test and examination marks for your sections, and see each student's result as the school's scheme works it out."
          stats={[
            { label: "School Year", value: years.problem ? "—" : yearList ? (year?.label ?? "None Yet") : null },
            {
              label: "Schemes",
              value: schemes.problem ? "—" : schemeList ? schemeList.length : year || !yearList ? null : 0,
            },
          ]}
        />

        {years.problem ? <LoadError problem={years.problem} onRetry={years.reload} /> : null}

        <Card className="space-y-5 p-6">
          {yearList && yearList.length === 0 ? (
            <EmptyState
              title="No School Year Yet"
              description="Your school admin adds the school year and its assessment schemes. Once a scheme is published, it appears here."
            />
          ) : yearList && year ? (
            <>
              {yearList.length > 1 ? (
                <SelectField
                  label="School Year"
                  containerClassName="w-60"
                  value={year.id}
                  onChange={(e) => url.set({ year: e.target.value }, { push: true })}
                >
                  {yearList.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                      {y.isCurrent ? " (Current)" : ""}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              {schemes.problem ? <LoadError problem={schemes.problem} onRetry={schemes.reload} /> : null}
              {!schemeList && !schemes.problem ? (
                <TableSkeleton label="Loading your schemes" />
              ) : schemeList && schemeList.length === 0 ? (
                <EmptyState
                  title="No Published Schemes Yet"
                  description={`None of the subjects you teach has a published scheme for ${year.label}. Your school admin publishes them.`}
                />
              ) : schemeList ? (
                <Table caption={`Your schemes for ${year.label}`} minWidth="40rem" busy={schemes.loading}>
                  <THead>
                    <TH>Scheme</TH>
                    <TH>Class</TH>
                    <TH>Subject</TH>
                    <TH>Status</TH>
                  </THead>
                  <TBody>
                    {schemeList.map((s) => (
                      <TR key={s.id}>
                        <TD>
                          <InlineLink href={`/teacher/marks/${s.id}`}>{s.name}</InlineLink>
                          {s.status === "SUPERSEDED" ? (
                            <span className="block text-content-subtle">Version {s.version}, read only</span>
                          ) : null}
                        </TD>
                        <TD>{s.classLevel?.displayName ?? "—"}</TD>
                        <TD>{s.boardCourse?.displayName ?? "—"}</TD>
                        <TD>
                          <SchemeStatusBadge status={s.status} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : null}
            </>
          ) : !years.problem ? (
            <TableSkeleton label="Loading school years" />
          ) : null}
        </Card>
      </div>
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MarksPage />
    </Suspense>
  );
}
