"use client";

/**
 * Weekly Report, for a student (#187): the weekly pages the school has
 * issued to them (the same page their parents get), newest first, on screen
 * and as a PDF. A withdrawn week is not shown.
 */
import { Suspense } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { pdfName } from "@/lib/weeklyReports";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadError } from "@/components/ui/AlertBanner";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/Field";
import { TableSkeleton } from "@/components/ui/Table";
import { PdfButton } from "@/components/reportCards/common";
import { WeeklyReportView } from "@/components/weeklyReports/WeeklyReportView";
import type { MyWeeklyReport, WeeklyReportData } from "@/types/weeklyReports";

function StudentWeeklyReportPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const ready = status === "ready" && Boolean(user);
  const url = useUrlState();
  const list = useApiQuery<{ reports: MyWeeklyReport[] }>(ready ? "/weekly-reports/mine" : null, {}, {
    action: "load your weekly reports",
  });
  const reports = list.problem ? null : (list.data?.reports ?? null);
  const chosen = reports?.find((r) => r.id === url.get("report")) ?? reports?.[0] ?? null;
  const page = useApiQuery<{ id: string; report: WeeklyReportData }>(chosen ? `/weekly-reports/mine/${chosen.id}` : null, {}, {
    action: "open your weekly report",
  });

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  return (
    <RoleShell role="STUDENT" user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Track"
          title="Weekly Report"
          description="Your week of practice, as your school shares it with your parents."
          stats={[
            { label: "Weeks", value: list.problem ? "—" : reports ? reports.length : null },
            { label: "Latest", value: list.problem ? "—" : reports ? (reports[0] ? reports[0].weekLabel : "None Yet") : null },
          ]}
          actions={
            chosen ? (
              <PdfButton
                action="download the weekly report"
                path={`/weekly-reports/mine/${chosen.id}/pdf`}
                name={pdfName("Weekly-Report", chosen.weekStart)}
                variant="accent"
                size="md"
              />
            ) : undefined
          }
        />
        {list.problem ? <LoadError problem={list.problem} onRetry={list.reload} /> : null}
        {!reports && !list.problem ? (
          <TableSkeleton label="Loading your weekly reports" rows={3} />
        ) : reports && reports.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              title="No Weekly Report Yet"
              description="Your weekly report appears here when your teacher issues it, usually at the end of the week."
            />
          </Card>
        ) : reports && chosen ? (
          <Card className="space-y-6 p-6">
            {reports.length > 1 ? (
              <SelectField
                label="Week"
                containerClassName="sm:w-80"
                value={chosen.id}
                onChange={(e) => url.set({ report: e.target.value }, { push: true })}
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.weekLabel}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {page.problem ? (
              <LoadError problem={page.problem} onRetry={page.reload} />
            ) : page.data && page.data.id === chosen.id ? (
              <WeeklyReportView report={page.data.report} />
            ) : (
              <TableSkeleton label="Opening your weekly report" rows={4} />
            )}
          </Card>
        ) : null}
      </div>
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <StudentWeeklyReportPage />
    </Suspense>
  );
}
