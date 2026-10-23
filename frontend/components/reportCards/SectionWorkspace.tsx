"use client";

/**
 * One section's report cards for one year (#188), for the school Admin and
 * for a teacher of the section: Records (attendance, grades and remarks, per
 * term), the Term 1 Card and the Year-End Card. Which year, section, view and
 * term are in the URL, so a refresh or a shared link opens the same place.
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { CARD_TERM_LABEL, RECORD_TERM_LABEL } from "@/lib/reportCards";
import { RoleShell } from "@/components/RoleShell";
import { LoadError } from "@/components/ui/AlertBanner";
import { Card } from "@/components/ui/Card";
import { InlineLink } from "@/components/ui/InlineLink";
import { MastheadSkeleton, PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { useLeaveGuard } from "@/components/assessment/common";
import { CardsPanel } from "@/components/reportCards/CardsPanel";
import { TermRecordsSheet } from "@/components/reportCards/TermRecordsSheet";
import type { CurrentUser, UserRole } from "@/types/auth";
import type { CardTerm, RecordTerm, ReportOverview } from "@/types/reportCards";

type View = "records" | CardTerm;

export function SectionWorkspace({
  role,
  user,
  backHref,
  backLabel,
}: {
  role: UserRole;
  user: CurrentUser | null;
  backHref: string;
  backLabel: string;
}) {
  const url = useUrlState();
  const pathname = usePathname();
  const schoolId = url.get("school");
  const yearId = url.get("year") ?? "";
  const classLevelId = url.get("class") ?? "";
  const section = url.get("section") ?? "";
  const overview = useApiQuery<ReportOverview>(
    yearId ? "/report-cards/overview" : null,
    { yearId, schoolId },
    { action: "open this section" },
  );
  const [dirty, setDirty] = useState(false);
  const leave = useLeaveGuard(dirty);

  const data = overview.problem ? null : overview.data;
  const entry = data?.sections.find((s) => s.classLevel.id === classLevelId && s.section === section) ?? null;
  const requested = url.get("view");
  const view: View = requested === "TERM_1" || requested === "YEAR_END" ? requested : "records";
  const term: RecordTerm = url.get("term") === "TERM_2" ? "TERM_2" : "TERM_1";
  const backWithScope = `${backHref}${schoolId || yearId ? "?" : ""}${new URLSearchParams(
    Object.fromEntries(Object.entries({ school: schoolId ?? "", year: yearId }).filter(([, v]) => v)),
  ).toString()}`;

  const hrefFor = (next: View) => {
    const params = new URLSearchParams(url.searchParams.toString());
    if (next === "records") params.delete("view");
    else params.set("view", next);
    return `${pathname}?${params.toString()}`;
  };
  const tabs: SubTab<View>[] = [
    { key: "records", label: "Attendance & Remarks", href: hrefFor("records") },
    { key: "TERM_1", label: CARD_TERM_LABEL.TERM_1, href: hrefFor("TERM_1") },
    { key: "YEAR_END", label: CARD_TERM_LABEL.YEAR_END, href: hrefFor("YEAR_END") },
  ];
  const title = entry ? `${entry.classLevel.displayName} ${entry.section}` : null;
  const scope = { schoolId, yearId, classLevelId, section };

  const missing = !yearId || !classLevelId || !section || (data && !entry);

  return (
    <RoleShell role={role} user={user} ambience="working" title={[title, backLabel]}>
      <div className="space-y-8">
        {overview.problem || missing ? (
          <div className="space-y-5">
            <InlineLink href={backWithScope} direction="back">
              {backLabel}
            </InlineLink>
            {overview.problem ? (
              <LoadError problem={overview.problem} onRetry={overview.reload} />
            ) : (
              <p className="text-sm text-content-muted">We couldn&apos;t find that section. Open it from the list.</p>
            )}
          </div>
        ) : (
          <>
            <PageHeader
              surface="masthead"
              back={
                <InlineLink href={backWithScope} direction="back" size="sm" tone="inverse">
                  {backLabel}
                </InlineLink>
              }
              eyebrow={data ? `${data.school.name} · ${data.year.label}` : undefined}
              title={
                title ?? (
                  <>
                    <MastheadSkeleton className="h-9 w-64 max-w-full" />
                    <span className="sr-only">Loading section</span>
                  </>
                )
              }
              description="Attendance, co-scholastic grades and remarks for each term, and the report cards the school issues."
              stats={[
                {
                  label: CARD_TERM_LABEL.TERM_1,
                  value: entry ? (entry.issues.TERM_1 ? "Issued" : "Not Yet") : null,
                  tone: entry?.issues.TERM_1 ? "good" : "default",
                },
                {
                  label: CARD_TERM_LABEL.YEAR_END,
                  value: entry ? (entry.issues.YEAR_END ? "Issued" : "Not Yet") : null,
                  tone: entry?.issues.YEAR_END ? "good" : "default",
                },
              ]}
            />
            {entry ? (
              <Card>
                <div className="flex flex-col gap-3 border-b border-line bg-surface-muted/60 px-5 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                  <SubTabs label="Report card views" tabs={tabs} active={view} />
                  {view === "records" ? (
                    <SegmentedControl
                      label="Term"
                      segments={(["TERM_1", "TERM_2"] as RecordTerm[]).map((t) => ({ key: t, label: RECORD_TERM_LABEL[t] }))}
                      value={term}
                      onChange={(next) => leave.confirm(() => url.set({ term: next === "TERM_1" ? null : next }, { push: true }))}
                    />
                  ) : null}
                </div>
                <div className="p-5 sm:p-6">
                  {view === "records" ? (
                    <TermRecordsSheet key={term} scope={scope} term={term} onDirtyChange={setDirty} />
                  ) : (
                    <CardsPanel
                      key={view}
                      scope={scope}
                      cardTerm={view}
                      sectionLabel={`${entry.classLevel.displayName} ${entry.section}`}
                      onChanged={overview.reload}
                    />
                  )}
                </div>
              </Card>
            ) : null}
          </>
        )}
      </div>
      {leave.dialog}
    </RoleShell>
  );
}
