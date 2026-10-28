"use client";

/** A student's mock papers (#166 step 4): open now, coming up, and done. */
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { durationText, STATUS_LABEL, STATUS_TONE } from "@/lib/mockPapers";
import { formatDateTime } from "@/lib/tracker";
import { LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import type { MyPaper } from "@/types/mockPapers";

function action(p: MyPaper): { label: string; variant: "primary" | "tinted" | "ghost" } {
  if (p.sitting === "IN_PROGRESS") return { label: "Carry On", variant: "primary" };
  if (p.sitting === "SUBMITTED") return { label: "See Results", variant: "tinted" };
  if (p.status === "OPEN") return { label: "Start", variant: "primary" };
  return { label: "View", variant: "ghost" };
}

function line(p: MyPaper): string {
  const parts = [`${p.totalMarks} marks`, durationText(p.timeMinutes)];
  if (p.sitting === "SUBMITTED") parts.push(`Your marks: ${p.score ?? "—"} / ${p.totalMarks}${p.waiting ? " so far" : ""}`);
  else if (p.sitting === "IN_PROGRESS") parts.push("Started");
  else if (p.status === "SCHEDULED") parts.push(`Opens ${formatDateTime(p.opensAt)}`);
  else if (p.status === "OPEN") parts.push(`Closes ${formatDateTime(p.closesAt)}`);
  else parts.push("Not sat");
  return parts.join(" · ");
}

export function StudentPapers() {
  const papers = useApiQuery<{ papers: MyPaper[] }>("/my-papers", {}, { action: "load your mock papers" });
  const list = papers.data?.papers ?? [];
  const open = list.filter((p) => p.status === "OPEN" && p.sitting !== "SUBMITTED").length;
  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="Practice"
        title="Mock Papers"
        description="Practice papers set by your teacher, to get ready for your exams. Every student gets their own questions. They don't count in your report card."
        stats={[
          { label: "Open Now", value: papers.problem ? "—" : papers.data ? open : null },
          { label: "Papers", value: papers.problem ? "—" : papers.data ? list.length : null },
        ]}
      />
      {papers.problem ? (
        <LoadError problem={papers.problem} onRetry={papers.reload} />
      ) : !papers.data ? (
        <TableSkeleton label="Loading your papers" rows={3} />
      ) : list.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Paper Yet" description="When your teacher sets a mock paper for your class, it appears here." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {list.map((p) => {
              const a = action(p);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-content">{p.title}</span>
                      <Badge tone={STATUS_TONE[p.status]}>
                        {STATUS_LABEL[p.status] === "Approved, Not Open Yet" ? "Coming Up" : STATUS_LABEL[p.status]}
                      </Badge>
                    </span>
                    <span className="block text-xs text-content-subtle">{line(p)}</span>
                  </span>
                  <ButtonLink href={`/student/papers/${p.id}`} size="sm" variant={a.variant}>
                    {a.label}
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
