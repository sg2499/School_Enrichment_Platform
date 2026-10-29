"use client";

/**
 * One bank question as a reviewer reads it (moved from Curriculum Studio's
 * page, #212): its text, options with the keyed answer marked in place, the
 * quality checks' verdict and flags, marking settings, explanation and hint,
 * and the one status step a reviewer takes after reading it.
 */
import { Check, HelpCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { MarkingSettings } from "@/components/curriculum/MarkingSettings";
import { QUALITY_STATUS_LABEL, QUALITY_STATUS_TONE, QUESTION_STATUS_TONE, STATUS_LABEL } from "@/components/curriculum/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { hasMarkingSettings } from "@/lib/marking";
import { cn } from "@/lib/utils";
import type { QualityStatus, QuestionDetail, QuestionStatus } from "@/types/curriculum";

const QUALITY_STATUS_ICON: Record<QualityStatus, typeof ShieldCheck> = {
  UNCHECKED: HelpCircle,
  FLAGGED: ShieldAlert,
  VERIFIED: ShieldCheck,
  UNVERIFIED: HelpCircle,
};

/** Question.status's DRAFT -> SME_REVIEW -> APPROVED -> PUBLISHED ladder
 * (mirrors _QUESTION_TRANSITIONS in routes_curriculum_admin.py) rendered as
 * the one action a reviewer takes after actually reading a question's
 * content below -- see QuestionCard.
 */
const QUESTION_NEXT_ACTION: Partial<Record<QuestionStatus, { label: string; next: QuestionStatus }>> = {
  DRAFT: { label: "Send to Review", next: "SME_REVIEW" },
  SME_REVIEW: { label: "Approve", next: "APPROVED" },
  APPROVED: { label: "Publish", next: "PUBLISHED" },
};
const QUESTION_BACK_ACTION: Partial<Record<QuestionStatus, { label: string; next: QuestionStatus }>> = {
  SME_REVIEW: { label: "Send Back to Draft", next: "DRAFT" },
  APPROVED: { label: "Send Back", next: "SME_REVIEW" },
  PUBLISHED: { label: "Send Back for Rework", next: "SME_REVIEW" },
};

/** The option letters a Select-type question's stored answer names
 *  ("B", or "A, C" for Multi Select), so the card can mark them in place.
 *  Anything else (numeric, text, ordering) returns an empty set and the
 *  "Correct answer" line below carries it alone. */
function correctLetters(question: QuestionDetail): Set<string> {
  if (!/select/i.test(question.questionType)) return new Set();
  return new Set(
    question.correctAnswer
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter((part) => /^[A-D]$/.test(part)),
  );
}

export function QuestionCard({
  question,
  pendingStatus,
  onAdvance,
  onMarkingSaved,
}: {
  question: QuestionDetail;
  /** The status this card is currently being moved to, if any -- so only
   *  the button that was pressed shows progress (both used to spin). */
  pendingStatus: QuestionStatus | null;
  onAdvance: (status: QuestionStatus) => void;
  onMarkingSaved: (updated: QuestionDetail) => void;
}) {
  const options: Array<[string, string | null]> = [
    ["A", question.optionA],
    ["B", question.optionB],
    ["C", question.optionC],
    ["D", question.optionD],
  ].filter(([, text]) => Boolean(text)) as Array<[string, string | null]>;
  const forward = QUESTION_NEXT_ACTION[question.status];
  const back = QUESTION_BACK_ACTION[question.status];
  const QualityIcon = QUALITY_STATUS_ICON[question.qualityStatus];
  const correct = correctLetters(question);
  const busy = pendingStatus !== null;

  return (
    <article
      aria-label={`Question ${question.code}`}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        question.qualityStatus === "FLAGGED" ? "border-coral-300 bg-coral-50/40" : "border-line bg-surface",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
            {question.code} &middot; {question.questionType}
            {question.difficulty ? ` · Difficulty ${question.difficulty}` : ""} &middot; {question.marks} mark
            {question.marks === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-sm font-medium leading-normal text-content">{question.stem}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={QUESTION_STATUS_TONE[question.status]} size="sm">
            {STATUS_LABEL[question.status]}
          </Badge>
          <Badge tone={QUALITY_STATUS_TONE[question.qualityStatus]} size="sm" icon={<QualityIcon className="h-3 w-3" />}>
            {QUALITY_STATUS_LABEL[question.qualityStatus]}
          </Badge>
        </div>
      </div>

      {question.qualityFlags.length > 0 ? (
        // coral-800 on coral-50: 8.7:1.
        <ul className="space-y-1 rounded-xl border border-coral-200 bg-coral-50 px-3 py-2">
          {question.qualityFlags.map((flag, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-normal text-coral-800">
              <span aria-hidden>&bull;</span>
              <span>{flag}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {options.length > 0 ? (
        <ul className="space-y-1">
          {options.map(([letter, text]) => {
            const isCorrect = correct.has(letter);
            return (
              <li
                key={letter}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2 py-1 text-sm",
                  // The keyed option is marked where it sits, so a reviewer
                  // checks it against the stem in one glance instead of
                  // cross-reading a letter from the line below. Tick + words
                  // for screen readers, not colour alone.
                  isCorrect ? "bg-jade-50 text-content ring-1 ring-inset ring-jade-200" : "text-content-muted",
                )}
              >
                <span className={cn("w-4 shrink-0 font-semibold", isCorrect ? "text-jade-700" : "text-content-subtle")}>{letter}.</span>
                <span className="min-w-0 flex-1">{text}</span>
                {isCorrect ? (
                  <>
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade-600" aria-hidden />
                    <span className="sr-only">(correct answer)</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="text-sm">
        <span className="font-semibold text-content-subtle">Correct answer: </span>
        <span className="text-content">{question.correctAnswer}</span>
      </p>

      {hasMarkingSettings(question) ? <MarkingSettings question={question} onSaved={onMarkingSaved} /> : null}

      {question.explanation ? (
        <p className="text-sm text-content-muted">
          <span className="font-semibold text-content-subtle">Explanation: </span>
          {question.explanation}
        </p>
      ) : null}

      {question.hint ? (
        <p className="text-sm text-content-muted">
          <span className="font-semibold text-content-subtle">Hint: </span>
          {question.hint}
        </p>
      ) : null}

      {forward || back ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line/70 pt-3">
          {forward ? (
            <Button
              size="sm"
              variant="secondary"
              loading={pendingStatus === forward.next}
              disabled={busy && pendingStatus !== forward.next}
              onClick={() => onAdvance(forward.next)}
            >
              {forward.label}
            </Button>
          ) : null}
          {back ? (
            <Button
              size="sm"
              variant="ghost"
              loading={pendingStatus === back.next}
              disabled={busy && pendingStatus !== back.next}
              onClick={() => onAdvance(back.next)}
            >
              {back.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
