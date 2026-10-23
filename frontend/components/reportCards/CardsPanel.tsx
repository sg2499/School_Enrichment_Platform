"use client";

/**
 * One term's cards for one section (#188): whether they can be issued yet
 * and what is missing; issuing (school Admin only); the issued cards, each
 * to view or download, and the section's PDF; withdrawing with a reason;
 * and earlier, withdrawn issues.
 */
import { useState } from "react";
import { Eye, Send, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { CARD_TERM_LABEL, pdfName, percentText } from "@/lib/reportCards";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import { CardView } from "@/components/reportCards/CardView";
import { IssueBadge, PdfButton, dayText } from "@/components/reportCards/common";
import type { CardTerm, IssueDetail, IssueSummary, Readiness, ReportCardData } from "@/types/reportCards";

export function CardsPanel({
  scope,
  cardTerm,
  sectionLabel,
  onChanged,
}: {
  scope: { schoolId: string | null; yearId: string; classLevelId: string; section: string };
  cardTerm: CardTerm;
  /** "Class 5 A", for file names. */
  sectionLabel: string;
  /** After an issue or a withdrawal, so the page's own figures follow. */
  onChanged?: () => void;
}) {
  const readiness = useApiQuery<Readiness>("/report-cards/readiness", { ...scope, cardTerm }, { action: "check these cards" });
  const history = useApiQuery<{ issues: IssueSummary[] }>("/report-cards/issues", scope, { action: "load earlier issues" });
  const ready = readiness.problem ? null : readiness.data;
  const current = ready?.issue ?? null;
  const detail = useApiQuery<IssueDetail>(current ? `/report-cards/issues/${current.id}` : null, {}, { action: "load the issued cards" });
  const [confirming, setConfirming] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);

  function reloadAll() {
    readiness.reload();
    history.reload();
    onChanged?.();
  }

  async function issue() {
    setIssuing(true);
    setReasons([]);
    try {
      await api.post("/report-cards/issues", { ...scope, cardTerm });
      setConfirming(false);
      reloadAll();
    } catch (err) {
      setConfirming(false);
      setReasons(refusalReasons(err, "issue these cards"));
      readiness.reload();
    } finally {
      setIssuing(false);
    }
  }

  async function withdraw() {
    if (!current) return;
    setBusy(true);
    setReasons([]);
    try {
      await api.post(`/report-cards/issues/${current.id}/withdraw`, { reason: why.trim() });
      setWithdrawing(false);
      setWhy("");
      reloadAll();
    } catch (err) {
      setWithdrawing(false);
      setReasons(refusalReasons(err, "withdraw these cards"));
    } finally {
      setBusy(false);
    }
  }

  if (readiness.problem) return <LoadError problem={readiness.problem} onRetry={readiness.reload} />;
  if (!ready) return <TableSkeleton label="Checking these cards" rows={3} />;

  const withdrawn = (history.data?.issues ?? []).filter((i) => i.cardTerm === cardTerm && i.status === "WITHDRAWN");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <IssueBadge status={current ? current.status : null} />
        <p className="text-sm text-content">
          {current
            ? `Issued on ${dayText(current.issuedAt)} to ${current.cardCount} ${current.cardCount === 1 ? "student" : "students"}.`
            : `${ready.students} ${ready.students === 1 ? "student" : "students"}${
                ready.subjects.length ? ` · ${ready.subjects.join(", ")}` : ""
              }`}
        </p>
        <span className="ml-auto flex flex-wrap gap-2">
          {current ? (
            <>
              <PdfButton
                path={`/report-cards/issues/${current.id}/pdf`}
                name={pdfName(sectionLabel, CARD_TERM_LABEL[cardTerm], current.yearLabel)}
                label="Download All Cards"
              />
              {ready.canIssue ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readiness.loading}
                  leadingIcon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setWithdrawing(true)}
                >
                  Withdraw
                </Button>
              ) : null}
            </>
          ) : ready.canIssue ? (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Send className="h-4 w-4" aria-hidden="true" />}
              disabled={ready.problems.length > 0 || readiness.loading}
              onClick={() => {
                setReasons([]);
                setConfirming(true);
              }}
            >
              Issue Cards
            </Button>
          ) : null}
        </span>
      </div>

      <ReasonsBox title="That didn't go through:" reasons={reasons} />
      {!current && ready.problems.length > 0 ? (
        <ReasonsBox
          title={`Before these cards can be issued (${ready.problems.length} ${ready.problems.length === 1 ? "thing" : "things"} to finish):`}
          reasons={ready.problems.slice(0, 50).concat(ready.problems.length > 50 ? [`and ${ready.problems.length - 50} more.`] : [])}
        />
      ) : null}
      {!current && ready.problems.length === 0 && ready.warnings.length > 0 ? (
        <AlertBanner
          tone="info"
          message={
            <div>
              Ready to issue. Still blank on the cards:
              <ul className="mt-1 list-disc pl-5">
                {ready.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          }
        />
      ) : null}
      {!current && ready.problems.length === 0 && ready.warnings.length === 0 ? (
        <AlertBanner tone="success" message="Everything is in place. These cards are ready to issue." />
      ) : null}
      {!current && !ready.canIssue ? (
        <p className="text-sm text-content-muted">Your school admin issues the cards once everything is in.</p>
      ) : null}

      {current ? (
        detail.problem ? (
          <LoadError problem={detail.problem} onRetry={detail.reload} />
        ) : !detail.data || detail.data.id !== current.id ? (
          <TableSkeleton label="Loading the issued cards" />
        ) : (
          <Table caption={`${CARD_TERM_LABEL[cardTerm]}s issued`} minWidth="40rem">
            <THead>
              <TH>Student</TH>
              <TH>Subjects</TH>
              <TH align="right">Card</TH>
            </THead>
            <TBody>
              {detail.data.cards.map((card) => (
                <TR key={card.id}>
                  <TD className="whitespace-nowrap">
                    <span className="font-semibold text-content">{card.studentName}</span>
                    <span className="block text-content-subtle">{card.studentCode}</span>
                  </TD>
                  <TD>
                    {card.subjects.map((s) => `${s.subject}: ${percentText(s.result)}${s.grade ? ` ${s.grade}` : ""}`).join(" · ")}
                  </TD>
                  <TD align="right">
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="tinted"
                        leadingIcon={<Eye className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => setViewing({ id: card.id, name: card.studentName })}
                      >
                        View
                      </Button>
                      <PdfButton
                        path={`/report-cards/cards/${card.id}/pdf`}
                        name={pdfName(card.studentCode, CARD_TERM_LABEL[cardTerm], current.yearLabel)}
                        label="PDF"
                        variant="tinted"
                      />
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )
      ) : null}

      {withdrawn.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-bold text-content">Withdrawn Earlier</p>
          <ul className="space-y-1 text-sm text-content-muted">
            {withdrawn.map((i) => (
              <li key={i.id}>
                Issued {dayText(i.issuedAt)}, withdrawn {dayText(i.withdrawnAt)}: {i.withdrawReason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => (issuing ? undefined : setConfirming(false))}
        title={`Issue the ${CARD_TERM_LABEL[cardTerm]}s?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={issuing} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={issuing} loadingLabel="Issuing" onClick={() => void issue()}>
              Issue Cards
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            {ready.students} {ready.students === 1 ? "student" : "students"} will see their card and can download it. The
            cards keep today&apos;s figures, even if marks change later.
          </p>
          {ready.warnings.length > 0 ? <p className="font-semibold">Some cards will have blanks: {ready.warnings.join(" ")}</p> : null}
          <p>To correct a card afterwards, withdraw these and issue again.</p>
        </div>
      </Modal>

      <Modal
        open={withdrawing}
        onClose={() => (busy ? undefined : setWithdrawing(false))}
        title="Withdraw These Cards?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setWithdrawing(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} loadingLabel="Withdrawing" disabled={why.trim() === ""} onClick={() => void withdraw()}>
              Withdraw
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content">
          <p>Students stop seeing these cards. They stay on record as withdrawn, and you can issue the cards again.</p>
          <TextField
            label="Reason"
            hint={`${why.length}/300`}
            maxLength={300}
            value={why}
            placeholder="For example: half-yearly marks re-checked"
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
      </Modal>

      {viewing ? <CardModal cardId={viewing.id} name={viewing.name} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

function CardModal({ cardId, name, onClose }: { cardId: string; name: string; onClose: () => void }) {
  const card = useApiQuery<{ card: ReportCardData }>(`/report-cards/cards/${cardId}`, {}, { action: "open this card" });
  return (
    <Modal open onClose={onClose} title={name} size="xl">
      {card.problem ? (
        <LoadError problem={card.problem} onRetry={card.reload} />
      ) : card.data ? (
        <CardView card={card.data.card} />
      ) : (
        <p className="text-sm text-content-muted">Opening the card…</p>
      )}
    </Modal>
  );
}
