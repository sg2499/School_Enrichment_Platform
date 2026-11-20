"use client";

/**
 * One bank question as a reviewer reads it (moved from Curriculum Studio's
 * page, #212): its text, options with the keyed answer marked in place, the
 * quality checks' verdict and flags, marking settings, explanation and hint,
 * and the one status step a reviewer takes after reading it.
 *
 * Laid out in bands, top to bottom (20 Nov 2026): a header with what the
 * question is and where it stands, the question itself, its answer key, its
 * marking, its explanation, and the review step. One card to a row, so the
 * marking form has room to be a form.
 */
import { Check, HelpCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { MarkingSettings } from "@/components/curriculum/MarkingSettings";
import { PdfUploadSetting } from "@/components/curriculum/PdfUploadSetting";
import { QUALITY_STATUS_LABEL, QUALITY_STATUS_TONE, QUESTION_STATUS_TONE, STATUS_LABEL } from "@/components/curriculum/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { hasMarkingSettings } from "@/lib/marking";
import { cn } from "@/lib/utils";
import type { QualityStatus, QuestionDetail, QuestionStatus } from "@/types/curriculum";
import { QuestionFigure } from "@/components/ui/QuestionFigure";
import { MathText } from "@/components/ui/MathText";

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

function Dot() {
  return (
    <span aria-hidden className="text-content-faint">
      &middot;
    </span>
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
  const flagged = question.qualityStatus === "FLAGGED";

  return (
    <article
      aria-label={`Question ${question.code}`}
      className={cn("overflow-hidden rounded-2xl border bg-surface shadow-xs", flagged ? "border-coral-300" : "border-line")}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3",
          flagged ? "border-coral-200 bg-coral-50" : "border-line bg-surface-muted",
        )}
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-content-muted">
          <span className="font-bold tracking-wide text-content">{question.code}</span>
          <Dot />
          <span>{question.questionType}</span>
          {question.difficulty ? (
            <>
              <Dot />
              <span>Difficulty {question.difficulty}</span>
            </>
          ) : null}
          <Dot />
          <span>
            {question.marks} mark{question.marks === 1 ? "" : "s"}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={QUESTION_STATUS_TONE[question.status]} size="sm">
            {STATUS_LABEL[question.status]}
          </Badge>
          <Badge tone={QUALITY_STATUS_TONE[question.qualityStatus]} size="sm" icon={<QualityIcon className="h-3 w-3" />}>
            {QUALITY_STATUS_LABEL[question.qualityStatus]}
          </Badge>
          {question.repeatOfId ? (
            <Badge tone="warning" size="sm">
              Repeat: left out of sets
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="space-y-5 px-5 py-5">
        <div className="space-y-3">
          <p className="text-base font-medium leading-relaxed text-content">
            <MathText>{question.stem}</MathText>
          </p>
          <QuestionFigure svg={question.figureSvg} />
        </div>

        {question.qualityFlags.length > 0 ? (
          // coral-800 on coral-50: 8.7:1.
          <ul className="space-y-1 rounded-xl border border-coral-200 bg-coral-50 px-3.5 py-2.5">
            {question.qualityFlags.map((flag, i) => (
              <li key={i} className="flex gap-2 text-sm leading-normal text-coral-800">
                <span aria-hidden>&bull;</span>
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {options.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {options.map(([letter, text]) => {
              const isCorrect = correct.has(letter);
              return (
                <li
                  key={letter}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
                    // The keyed option is marked where it sits, so a reviewer
                    // checks it against the stem in one glance. Tick + words
                    // for screen readers, not colour alone.
                    isCorrect ? "border-jade-300 bg-jade-50 text-content" : "border-line text-content-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                      isCorrect ? "bg-jade-600 text-white" : "bg-surface-muted text-content-subtle",
                    )}
                  >
                    {letter}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{text}</span>
                  {isCorrect ? (
                    <>
                      <Check className="mt-1 h-4 w-4 shrink-0 text-jade-700" aria-hidden />
                      <span className="sr-only">(correct answer)</span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-jade-50 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-jade-200">
          <span className="text-xs font-bold uppercase tracking-eyebrow text-jade-800">Correct answer</span>
          <span className="font-semibold text-content">{question.correctAnswer}</span>
        </p>

        {hasMarkingSettings(question) ? <MarkingSettings question={question} onSaved={onMarkingSaved} /> : null}
        {!hasMarkingSettings(question) && (!question.autoGradable || question.questionType === "Constructed Response") ? (
          <PdfUploadSetting question={question} onSaved={onMarkingSaved} />
        ) : null}

        {question.explanation || question.hint ? (
          <dl className="grid gap-x-4 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
            {question.explanation ? (
              <>
                <dt className="text-xs font-bold uppercase tracking-eyebrow text-content-subtle sm:pt-0.5">Explanation</dt>
                <dd className="text-content-muted">
                  <MathText>{question.explanation}</MathText>
                </dd>
              </>
            ) : null}
            {question.hint ? (
              <>
                <dt className="text-xs font-bold uppercase tracking-eyebrow text-content-subtle sm:pt-0.5">Hint</dt>
                <dd className="text-content-muted">
                  <MathText>{question.hint}</MathText>
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </div>

      {forward || back ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
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
        </footer>
      ) : null}
    </article>
  );
}
