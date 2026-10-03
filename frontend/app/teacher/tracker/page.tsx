"use client";

/**
 * Practice Tracker (1 Oct 2026) -- the teacher's results workspace.
 *
 * Replaces the "My Assignments" list and the results modal that used to sit
 * under the assign form on /teacher/assignments. Three sub-tabs, each a
 * full-width view of its own, never a modal:
 *
 *   Assignments   every assignment the teacher can see, with progress
 *   Students      a section's students and their practice numbers
 *   Needs Review  submitted attempts waiting for the teacher's marks
 *
 * The active tab, section, search, filters and page number all live in the
 * URL (lib/hooks/useUrlState), so Back/refresh/bookmarks behave. Drilling
 * into one assignment, one student or one attempt is a real route under
 * /teacher/tracker/..., and RoleShell gives those routes the full screen.
 *
 * Every list is paginated by the server (routes_practice_tracker.py) --
 * nothing here ever loads a whole roster or a whole school's attempts.
 * What a teacher sees follows the admin's section assignments, including
 * the handover rule: a past section's history stays readable (marked
 * "Past" / "Read Only"), anything set after the handover isn't shown.
 *
 * UI revamp, Phase A (2 Oct 2026): the four summary figures count up and
 * the page sits on the workspace ambience. Its three panels live in
 * components/tracker/; their "Clear Search" buttons were still `ghost`
 * after that pass and are `tinted` now, per Button.tsx's rule.
 *
 * Masthead pass, same day. Phase A left this page's header as it was -- a
 * title and one grey sentence on the bare canvas, above a row of white
 * tiles -- on the reasoning that a single sentence needs no container.
 * Shailesh, live: "The hero sections are still floating text." The header
 * is now a masthead (PageHeader surface="masthead"), and the four tiles
 * have moved into it as its stat strip rather than being repeated under
 * it: what a teacher reads under "Practice Tracker" is the state of their
 * practice -- how much is live, how much is waiting for them -- with the
 * sentence that explains the page as the caption to those figures. Same
 * four figures from the same single request; nothing new is fetched. The
 * wash behind the page is the shell's now, at its working level (RoleShell's
 * `ambience` prop; components/brand/Ambience.tsx has the measurements).
 * The three panels are untouched apart from that one button.
 */

import { Suspense } from "react";
import { ClipboardList, Hourglass, Send, Users } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { PageHeader, type PageHeaderStat } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { SectionPicker } from "@/components/tracker/TrackerBits";
import { AssignmentsPanel } from "@/components/tracker/AssignmentsPanel";
import { StudentsPanel } from "@/components/tracker/StudentsPanel";
import { ReviewQueuePanel } from "@/components/tracker/ReviewQueuePanel";
import type { TrackerOverview } from "@/types/tracker";

type TabKey = "assignments" | "students" | "review";
const TABS: TabKey[] = ["assignments", "students", "review"];

function tabFromParam(value: string | null): TabKey {
  return TABS.includes(value as TabKey) ? (value as TabKey) : "assignments";
}

function TrackerWorkspace() {
  const { user, status } = useProtectedPage("TEACHER");
  const url = useUrlState();
  const ready = status === "ready";
  const overview = useApiQuery<TrackerOverview>("/learning/tracker/overview", {}, ready);

  if (!ready) return <LoadingScreen />;

  const tab = tabFromParam(url.get("tab"));
  const scope = url.get("scope") ?? "";
  const sections = overview.data?.sections ?? [];
  // Ignore a scope from an old link that no longer names one of my sections.
  const scopeKey = sections.length === 0 || sections.some((s) => s.key === scope) ? scope : "";
  const counts = overview.data?.counts;
  const currentSections = sections.filter((s) => s.isCurrent).length;

  // Tab links keep the section, drop everything tab-specific (search,
  // filters, page) -- each tab starts fresh on its own first page.
  const tabHref = (key: TabKey) => {
    const params = new URLSearchParams();
    if (key !== "assignments") params.set("tab", key);
    if (scopeKey) params.set("scope", scopeKey);
    const query = params.toString();
    return query ? `/teacher/tracker?${query}` : "/teacher/tracker";
  };

  const tabs: SubTab<TabKey>[] = [
    { key: "assignments", label: "Assignments", href: tabHref("assignments"), icon: <ClipboardList className="h-4 w-4" />, count: counts?.assignments },
    { key: "students", label: "Students", href: tabHref("students"), icon: <Users className="h-4 w-4" /> },
    {
      key: "review",
      label: "Needs Review",
      href: tabHref("review"),
      icon: <Hourglass className="h-4 w-4" />,
      count: counts?.needsReview,
      attention: true,
    },
  ];

  const page = pageFromParam(url.get("page"));
  const q = url.get("q") ?? "";
  // A section switch is a change of context, so it gets a history entry
  // (Back returns to the previous section); search, filters and paging
  // replace the current entry instead.
  const setScope = (key: string) => url.set({ scope: key, page: null }, { push: true });
  const panelProps = {
    scopeKey,
    page,
    q,
    onChange: (updates: Record<string, string | number | null>) => url.set(updates),
  };

  // The masthead's figures. `null` while the overview loads (a placeholder
  // bar); "—" if it failed, with the banner below saying why -- never a
  // zero, which would read as a real count. The tiles these replace printed
  // "–" for both cases, and "Nothing waiting" under Waiting For Marks even
  // before the count had arrived; a hint now appears only once the number
  // it describes is known.
  const pending = !overview.data && !overview.error;
  const figure = (value: number | null | undefined) => (pending ? null : (value ?? "—"));
  const stats: PageHeaderStat[] = [
    {
      label: "Active Assignments",
      value: figure(counts?.activeAssignments),
      hint: counts ? `${counts.assignments} in total` : undefined,
    },
    {
      label: "Waiting For Marks",
      value: figure(counts?.needsReview),
      hint: counts ? (counts.needsReview > 0 ? "Open Needs Review to mark them" : "Nothing waiting") : undefined,
      tone: counts && counts.needsReview > 0 ? "attention" : "default",
    },
    {
      label: "Students On Roster",
      value: figure(counts?.studentsOnRoster),
      hint: "Across your current sections",
    },
    {
      label: "Your Sections",
      value: pending ? null : overview.data ? currentSections : "—",
      hint: sections.length > currentSections ? `${sections.length - currentSections} past, read only` : "Assigned by your admin",
    },
  ];

  return (
    <RoleShell role="TEACHER" user={user} ambience="working">
      {/* space-y-8: the working-page rhythm (Assign, People, Security, Daily
          Practice); dashboards use space-y-10. This family alone was 7. */}
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Teaching Workspace"
          title="Practice Tracker"
          description="How every section is getting on with the practice you've set, and the written answers waiting for your marks."
          stats={stats}
          actions={
            // Still `accent`: the saffron button is the single most inviting
            // action on this view, and on indigo it is the student hero's
            // pairing (brand-950 on the saffron gradient, 4.9 to 11.2:1).
            <ButtonLink href="/teacher/assign" variant="accent" leadingIcon={<Send className="h-4 w-4" />}>
              Assign Practice
            </ButtonLink>
          }
        />

        {overview.error ? (
          <AlertBanner tone="error" message={`Couldn't load your tracker summary (${overview.error}).`} />
        ) : null}

        <Card className="animate-fade-up delay-70">
          <div className="flex flex-col gap-3 border-b border-line bg-surface-muted/60 px-5 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <SubTabs label="Practice Tracker views" tabs={tabs} active={tab} />
            <SectionPicker sections={sections} value={scopeKey} onChange={setScope} disabled={!overview.data} />
          </div>
          <div className="p-5 sm:p-6">
            {tab === "assignments" ? (
              <AssignmentsPanel {...panelProps} status={url.get("status") ?? ""} />
            ) : tab === "students" ? (
              <StudentsPanel {...panelProps} />
            ) : (
              <ReviewQueuePanel {...panelProps} />
            )}
          </div>
        </Card>
      </div>
    </RoleShell>
  );
}

export default function PracticeTrackerPage() {
  // useSearchParams (inside useUrlState) needs a Suspense boundary on a
  // statically prerendered route.
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TrackerWorkspace />
    </Suspense>
  );
}
