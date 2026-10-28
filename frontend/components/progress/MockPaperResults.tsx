/**
 * Mock papers handed in (#207, #208): on a student's My Progress, and on a
 * student's page in the tracker for papers the teacher can read. Their
 * answers also count in the skill map, like practice.
 */
import { FileText } from "lucide-react";
import { formatDay } from "@/lib/tracker";
import { mockMarksText } from "@/lib/progress";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MockPaperResult } from "@/types/progress";

export function MockPaperResults({
  papers,
  title = "Mock Papers",
  description,
  hrefFor,
  headingId = "mock-heading",
}: {
  papers: MockPaperResult[];
  title?: string;
  description: string;
  hrefFor?: (paperId: string) => string | null;
  headingId?: string;
}) {
  if (papers.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2 id={headingId} className="font-display text-display-sm text-content">
          {title}
        </h2>
        <p className="mt-1 text-sm text-content-muted">{description}</p>
      </div>
      <Card>
        <ul className="divide-y divide-line">
          {papers.map((paper) => {
            const href = hrefFor ? hrefFor(paper.paperId) : null;
            return (
              <li key={paper.paperId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <span className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-content">{paper.title}</span>
                    <span className="block text-xs text-content-subtle">
                      Handed in {formatDay(paper.handedInAt) ?? "—"}
                      {paper.waiting ? ` · ${paper.waiting} written ${paper.waiting === 1 ? "answer" : "answers"} still to be marked` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular text-content">{mockMarksText(paper)}</span>
                  {href ? (
                    <ButtonLink href={href} size="sm" variant="tinted">
                      See Result
                    </ButtonLink>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
