"use client";

/**
 * One scheme, for the school admin and for a teacher (#165): its masthead,
 * and three views -- the scheme itself (the draft editor, or the published
 * scheme to read), Marks for a section, and Results for a section. The
 * view, section and component live in the URL, so a refresh or a shared
 * link opens the same sheet.
 */
import { useState } from "react";
import { CopyPlus, Trash } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { RoleShell } from "@/components/RoleShell";
import type { CurrentUser, UserRole } from "@/types/auth";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { MastheadSkeleton, PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/Field";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { MarksEntry } from "@/components/assessment/MarksEntry";
import { ResultsTable } from "@/components/assessment/ResultsTable";
import { SchemeEditor } from "@/components/assessment/SchemeEditor";
import { SchemeOverview } from "@/components/assessment/SchemeOverview";
import { SchemeStatusBadge, schemeScope, useLeaveGuard } from "@/components/assessment/common";
import { Badge } from "@/components/ui/Badge";
import type { SchemeDetail, SchemeSection } from "@/types/assessment";

type View = "scheme" | "marks" | "results";

export function SchemeWorkspace({
  schemeId,
  backHref,
  backLabel,
  role,
  user,
  defaultView = "scheme",
}: {
  schemeId: string;
  backHref: string;
  backLabel: string;
  role: UserRole;
  user: CurrentUser | null;
  /** The view a plain link opens: a teacher comes to enter marks. */
  defaultView?: View;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const url = useUrlState();
  const query = useApiQuery<SchemeDetail>(`/assessment/schemes/${schemeId}`, {}, { action: "open this scheme" });
  const scheme = query.problem ? null : query.data;
  const sectionsQuery = useApiQuery<{ sections: SchemeSection[] }>(
    scheme && !scheme.isTemplate && scheme.status !== "DRAFT" ? `/assessment/schemes/${schemeId}/sections` : null,
    {},
    { action: "load the sections" },
  );
  const [busy, setBusy] = useState(false);
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Unsaved marks or draft edits below: moving away asks first.
  const [dirty, setDirty] = useState(false);
  const leave = useLeaveGuard(dirty);

  const hasSheets = Boolean(scheme && !scheme.isTemplate && scheme.status !== "DRAFT");
  const requested = url.get("view");
  const asked: View = requested === "marks" || requested === "results" || requested === "scheme" ? requested : defaultView;
  const view: View = hasSheets ? asked : "scheme";
  const sections = sectionsQuery.data?.sections ?? [];
  const section = sections.find((s) => s.section === url.get("section"))?.section ?? sections[0]?.section ?? null;
  const componentId =
    scheme?.components.find((c) => c.id === url.get("component"))?.id ?? scheme?.components[0]?.id ?? null;

  const hrefFor = (next: View) => {
    const params = new URLSearchParams(url.searchParams.toString());
    if (next === defaultView) params.delete("view");
    else params.set("view", next);
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
  const tabs: SubTab<View>[] = [
    { key: "scheme", label: scheme?.status === "DRAFT" ? "Edit Scheme" : "Scheme", href: hrefFor("scheme") },
    ...(hasSheets
      ? [
          { key: "marks" as const, label: "Marks", href: hrefFor("marks") },
          { key: "results" as const, label: "Results", href: hrefFor("results") },
        ]
      : []),
  ];

  async function newVersion() {
    if (!scheme) return;
    setBusy(true);
    setActionProblem(null);
    try {
      const { data } = await api.post<SchemeDetail>(`/assessment/schemes/${scheme.id}/new-version`);
      router.push(`${backHref}/${data.id}`);
    } catch (err) {
      setActionProblem(describeApiError(err, "make a new version").message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!scheme) return;
    setBusy(true);
    setActionProblem(null);
    try {
      await api.delete(`/assessment/schemes/${scheme.id}`);
      router.push(backHref);
    } catch (err) {
      setConfirmDelete(false);
      setActionProblem(describeApiError(err, "delete this draft").message);
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <InlineLink href={backHref} direction="back" size="sm" tone="inverse">
      {backLabel}
    </InlineLink>
  );

  if (query.problem) {
    return (
      <RoleShell role={role} user={user} ambience="working" title={["Scheme", backLabel]}>
        <div className="space-y-5">
          <InlineLink href={backHref} direction="back">
            {backLabel}
          </InlineLink>
          <LoadError problem={query.problem} onRetry={query.reload} />
        </div>
      </RoleShell>
    );
  }

  const actions =
    scheme && scheme.canManage ? (
      scheme.status === "PUBLISHED" && !scheme.newerVersion ? (
        <Button
          variant="accent"
          leadingIcon={<CopyPlus className="h-4 w-4" aria-hidden="true" />}
          loading={busy}
          loadingLabel="Copying"
          onClick={() => void newVersion()}
        >
          Make a New Version
        </Button>
      ) : scheme.status === "DRAFT" ? (
        <Button
          variant="secondary"
          leadingIcon={<Trash className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setConfirmDelete(true)}
        >
          Delete Draft
        </Button>
      ) : undefined
    ) : undefined;

  return (
    <RoleShell role={role} user={user} ambience="working" title={[scheme?.name, backLabel]}>
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        back={back}
        eyebrow={scheme ? schemeScope(scheme) : undefined}
        title={
          scheme ? (
            scheme.name
          ) : (
            <>
              <MastheadSkeleton className="h-9 w-96 max-w-full" />
              <span className="sr-only">Loading scheme</span>
            </>
          )
        }
        meta={
          scheme ? (
            <>
              <SchemeStatusBadge status={scheme.status} onDark />
              <Badge tone="inverse">Version {scheme.version}</Badge>
            </>
          ) : undefined
        }
        actions={actions}
        stats={[
          { label: "Components", value: scheme ? scheme.components.length : null },
          { label: "Pass Mark", value: scheme ? `${scheme.passPercent}%` : null },
          { label: "Grades", value: scheme ? scheme.gradeBands.length : null },
        ]}
      />

      {actionProblem ? <p role="alert" className="text-sm font-semibold text-coral-700">{actionProblem}</p> : null}
      {/* A newer draft is only worth pointing to for someone who can open it. */}
      {scheme?.newerVersion && (scheme.newerVersion.status !== "DRAFT" || scheme.canManage) ? (
        <p className="rounded-2xl bg-surface-accent p-4 text-sm text-content">
          Version {scheme.newerVersion.version} of this scheme is{" "}
          {scheme.newerVersion.status === "DRAFT" ? "being drafted" : "now the published one"}.{" "}
          <InlineLink href={`${backHref}/${scheme.newerVersion.id}`}>Open Version {scheme.newerVersion.version}</InlineLink>
        </p>
      ) : null}

      {scheme ? (
        <Card>
          {tabs.length > 1 ? (
            <div className="flex flex-col gap-3 border-b border-line bg-surface-muted/60 px-5 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <SubTabs label="Scheme views" tabs={tabs} active={view} />
              {view !== "scheme" ? (
                sections.length > 0 ? (
                  <SelectField
                    label="Section"
                    containerClassName="lg:w-56"
                    value={section ?? ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      leave.confirm(() => url.set({ section: next }, { push: true }));
                    }}
                  >
                    {sections.map((s) => (
                      <option key={s.section} value={s.section}>
                        Section {s.section}
                        {s.canEnterMarks ? "" : " (read only)"}
                      </option>
                    ))}
                  </SelectField>
                ) : null
              ) : null}
            </div>
          ) : null}
          <div className="p-5 sm:p-6">
            {view === "scheme" ? (
              scheme.status === "DRAFT" && scheme.canManage ? (
                <SchemeEditor scheme={scheme} onChanged={(next) => query.setData(next)} onDirtyChange={setDirty} />
              ) : (
                <SchemeOverview scheme={scheme} />
              )
            ) : sectionsQuery.problem ? (
              <LoadError problem={sectionsQuery.problem} onRetry={sectionsQuery.reload} />
            ) : !sectionsQuery.data ? (
              <p className="text-sm text-content-muted">Loading sections…</p>
            ) : !section ? (
              <p className="text-sm text-content-muted">
                No section of this class has students yet. Students appear here once they are on the roster.
              </p>
            ) : view === "marks" ? (
              componentId ? (
                <MarksEntry
                  key={`${section}-${componentId}`}
                  schemeId={scheme.id}
                  components={scheme.components}
                  section={section}
                  componentId={componentId}
                  onComponentChange={(id) => url.set({ component: id })}
                  onDirtyChange={setDirty}
                />
              ) : null
            ) : (
              <ResultsTable key={section} schemeId={scheme.id} section={section} decimalPlaces={scheme.decimalPlaces} />
            )}
          </div>
        </Card>
      ) : null}

      {leave.dialog}
      <Modal
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        title="Delete This Draft?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} loadingLabel="Deleting" onClick={() => void deleteDraft()}>
              Delete Draft
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">The draft and its settings are removed. Nothing published is affected.</p>
      </Modal>
    </div>
    </RoleShell>
  );
}
