"use client";

/**
 * Reports (#224) for the Super Admin: how much each school is using Krama.
 * Counts only -- no names of children, no marks. "As of" is the time the
 * figures were counted, which is when the page was opened.
 */
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { lastActiveLabel } from "@/lib/schools";
import { activityTime } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { UsageOverview } from "@/types/overview";

export function UsageReport() {
  const usage = useApiQuery<UsageOverview>("/overview/usage", {}, { action: "load the usage report" });
  const data = usage.data;
  const value = (key: string) => (usage.problem ? "—" : data ? (data.totals[key] ?? 0) : null);

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Operations"
        title="Reports"
        description="How much each school is using Krama: who has signed in, and the practice, papers and reports its teachers have set and issued."
        stats={[
          { label: "Students", value: value("students") },
          { label: "Teachers", value: value("teachers") },
          { label: "Practice Sets Set", value: value("assignmentsSet"), hint: data ? `${data.totals.setsHandedIn ?? 0} handed in` : undefined },
          { label: "Mock Papers Set", value: value("papersSet"), hint: data ? `${data.totals.papersHandedIn ?? 0} handed in` : undefined },
        ]}
      />

      {usage.problem ? <LoadError problem={usage.problem} onRetry={usage.reload} /> : null}
      {!data && !usage.problem ? <TableSkeleton label="Loading the report" rows={4} /> : null}

      {data && data.schools.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Schools Yet" description="Add a school under Schools and its usage appears here." />
        </Card>
      ) : null}

      {data && data.schools.length > 0 ? (
        <Card>
          <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
            <CardTitle>Every School</CardTitle>
            <CardDescription>Counted {activityTime(data.asOf)}. Handed in is the number of times students handed work in.</CardDescription>
          </CardHeader>
          <CardBody>
            <Table caption="Usage of Krama by school" minWidth="62rem">
              <THead>
                  <TH>School</TH>
                  <TH align="right">Students</TH>
                  <TH align="right">Teachers</TH>
                  <TH align="right">Not Signed In</TH>
                  <TH>Last Active</TH>
                  <TH align="right">Practice Sets</TH>
                  <TH align="right">Mock Papers</TH>
                  <TH align="right">Report Cards</TH>
                  <TH align="right">Weekly Reports</TH>
                </THead>
              <TBody>
                {data.schools.map((school) => (
                  <TR key={school.id}>
                    <TD>
                      <span className="font-semibold">{school.name}</span>
                      {!school.isActive ? (
                        <Badge tone="warning" className="ml-2">
                          Suspended
                        </Badge>
                      ) : null}
                    </TD>
                    <TD align="right" className="tabular">{school.students}</TD>
                    <TD align="right" className="tabular">{school.teachers}</TD>
                    <TD align="right" className="tabular">{school.notSignedIn}</TD>
                    <TD>{lastActiveLabel(school.lastActiveAt)}</TD>
                    <TD align="right" className="tabular">
                      {school.assignmentsSet}
                      <span className="block text-[0.6875rem] text-content-subtle">
                        {school.setsHandedIn} handed in
                      </span>
                    </TD>
                    <TD align="right" className="tabular">
                      {school.papersSet}
                      <span className="block text-[0.6875rem] text-content-subtle">
                        {school.papersHandedIn} handed in
                      </span>
                    </TD>
                    <TD align="right" className="tabular">{school.reportCardSets}</TD>
                    <TD align="right" className="tabular">{school.weeklyReportSets}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
