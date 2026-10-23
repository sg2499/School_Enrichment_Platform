"use client";

/**
 * Report Card, for a student (#188): the cards the school has issued to
 * them, newest first, each on screen and as a PDF to download. A card the
 * school has withdrawn is not shown.
 */
import { Suspense } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { pdfName } from "@/lib/reportCards";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadError } from "@/components/ui/AlertBanner";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/Field";
import { TableSkeleton } from "@/components/ui/Table";
import { CardView } from "@/components/reportCards/CardView";
import { PdfButton } from "@/components/reportCards/common";
import type { MyCard, ReportCardData } from "@/types/reportCards";

function StudentReportCardPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const ready = status === "ready" && Boolean(user);
  const url = useUrlState();
  const list = useApiQuery<{ cards: MyCard[] }>(ready ? "/report-cards/mine" : null, {}, { action: "load your report cards" });
  const cards = list.problem ? null : (list.data?.cards ?? null);
  const chosen = cards?.find((c) => c.id === url.get("card")) ?? cards?.[0] ?? null;
  const card = useApiQuery<{ id: string; card: ReportCardData }>(chosen ? `/report-cards/mine/${chosen.id}` : null, {}, {
    action: "open your report card",
  });

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  return (
    <RoleShell role="STUDENT" user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Track"
          title="Report Card"
          description="The report cards your school has issued to you."
          stats={[
            { label: "Cards", value: list.problem ? "—" : cards ? cards.length : null },
            { label: "Latest", value: list.problem ? "—" : cards ? (cards[0] ? cards[0].title.replace(" Report Card", "") : "None Yet") : null },
          ]}
          actions={
            chosen ? (
              <PdfButton
                path={`/report-cards/mine/${chosen.id}/pdf`}
                name={pdfName(chosen.title, chosen.year)}
                variant="accent"
                size="md"
              />
            ) : undefined
          }
        />
        {list.problem ? <LoadError problem={list.problem} onRetry={list.reload} /> : null}
        {!cards && !list.problem ? (
          <TableSkeleton label="Loading your report cards" rows={3} />
        ) : cards && cards.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              title="No Report Card Yet"
              description="Your report card appears here when your school issues it, at the end of each term."
            />
          </Card>
        ) : cards && chosen ? (
          <Card className="space-y-6 p-6">
            {cards.length > 1 ? (
              <SelectField
                label="Report Card"
                containerClassName="sm:w-80"
                value={chosen.id}
                onChange={(e) => url.set({ card: e.target.value }, { push: true })}
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}, {c.year}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {card.problem ? (
              <LoadError problem={card.problem} onRetry={card.reload} />
            ) : card.data && card.data.id === chosen.id ? (
              <CardView card={card.data.card} />
            ) : (
              <TableSkeleton label="Opening your report card" rows={4} />
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
      <StudentReportCardPage />
    </Suspense>
  );
}
