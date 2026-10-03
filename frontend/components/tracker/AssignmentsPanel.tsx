"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Send } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { FilterChips } from "@/components/ui/FilterChips";
import { Pagination } from "@/components/ui/Pagination";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SearchInput } from "@/components/ui/SearchInput";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { RosterIllustration } from "@/components/brand/Graphics";
import { AssignmentStatusBadge, PercentText, ReadOnlyBadge, scopeParams } from "@/components/tracker/TrackerBits";
import { formatDay, scopeShort } from "@/lib/tracker";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { Paginated, TrackerAssignmentRow } from "@/types/tracker";

type StatusFilter = "" | "ACTIVE" | "CLOSED";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "CLOSED", label: "Closed" },
];

export function AssignmentsPanel({
  scopeKey,
  page,
  q,
  status,
  onChange,
}: {
  scopeKey: string;
  page: number;
  q: string;
  status: string;
  onChange: (updates: Record<string, string | number | null>) => void;
}) {
  const router = useRouter();
  const statusFilter: StatusFilter = status === "ACTIVE" || status === "CLOSED" ? status : "";
  const { data, error, loading } = useApiQuery<Paginated<TrackerAssignmentRow>>("/learning/tracker/assignments", {
    ...scopeParams(scopeKey),
    status: statusFilter,
    q,
    page,
    pageSize: 20,
  });

  const filtered = Boolean(q || statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onSearch={(value) => onChange({ q: value, page: null })} label="Search assignments by title" />
        <FilterChips
          label="Filter by status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(value) => onChange({ status: value, page: null })}
        />
      </div>

      {error ? <AlertBanner tone="error" message={`Couldn't load assignments (${error}).`} /> : null}

      {!data && loading ? (
        <TableSkeleton label="Loading assignments" />
      ) : data && data.total === 0 ? (
        filtered ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
            <ClipboardList className="h-5 w-5 text-content-faint" aria-hidden />
            <p className="text-[0.875rem] font-semibold text-content">No assignments match that</p>
            {/* `tinted`, not `ghost` (2 Oct 2026): this is the only action in
                the box, and Button.tsx's rule is that an action on its own
                needs chrome of its own -- ghost left it as a grey word
                under the message. */}
            <Button type="button" variant="tinted" size="sm" onClick={() => onChange({ q: null, status: null, page: null })}>
              Clear Search And Filters
            </Button>
          </div>
        ) : (
          <EmptyState
            illustration={<RosterIllustration />}
            status={{ label: "Nothing Assigned Yet", tone: "brand" }}
            title={scopeKey ? "Nothing set for this section yet" : "No practice to track yet"}
            description="Assignments you set — and any your school admin sets for your sections — show up here with each section's progress."
            actions={
              <ButtonLink href="/teacher/assign" size="sm" leadingIcon={<Send className="h-4 w-4" />}>
                Assign Practice
              </ButtonLink>
            }
          />
        )
      ) : data ? (
        <>
          <Table caption={`Assignments, page ${data.page} of ${data.totalPages}`} busy={loading} minWidth="58rem">
            <THead>
              <TH>Practice</TH>
              <TH>Section</TH>
              <TH className="w-56">Progress</TH>
              <TH align="right">Average</TH>
              <TH align="center">To Mark</TH>
              <TH>Due</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {data.items.map((row) => {
                const href = `/teacher/tracker/assignments/${row.id}`;
                const p = row.progress;
                return (
                  <TR key={row.id} onClick={() => router.push(href)}>
                    <TD className="max-w-[22rem]">
                      <Link
                        href={href}
                        onClick={(event) => event.stopPropagation()}
                        className="block truncate font-semibold text-content hover:text-content-brand"
                      >
                        {row.title ?? "Learning Activity"}
                      </Link>
                      <span className="mt-0.5 block truncate text-xs text-content-subtle">
                        {[
                          row.activityType ? ACTIVITY_TYPE_LABEL[row.activityType] : null,
                          row.isMine ? null : row.assignedByName ? `Set by ${row.assignedByName}` : "Set by your school",
                          row.createdAt ? `Set ${formatDay(row.createdAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-content-muted">{scopeShort(row)}</TD>
                    <TD>
                      <ProgressBar
                        total={p.targeted}
                        segments={[
                          { value: p.completed, className: "bg-jade-500", label: "completed" },
                          { value: p.inProgress, className: "bg-saffron-400", label: "in progress" },
                        ]}
                      />
                      <span className="mt-1.5 block text-xs text-content-subtle tabular">
                        {p.completed} of {p.targeted} completed
                        {p.inProgress > 0 ? ` · ${p.inProgress} in progress` : ""}
                      </span>
                    </TD>
                    <TD align="right">
                      <PercentText percent={p.averagePercent} />
                    </TD>
                    <TD align="center">
                      {p.needsReview > 0 ? (
                        <Badge tone="warning">{p.needsReview}</Badge>
                      ) : (
                        <span className="text-content-faint">&mdash;</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-content-muted">{formatDay(row.dueDate) ?? "—"}</TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <AssignmentStatusBadge status={row.status} />
                        {!row.canAct ? <ReadOnlyBadge /> : null}
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={(next) => onChange({ page: next })}
            noun="assignment"
            label="Assignment pages"
            busy={loading}
          />
        </>
      ) : null}
    </div>
  );
}
