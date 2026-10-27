"use client";

/**
 * The answer controls a student types into: options, number boxes, answers
 * in parts, written answers and "Your Working". Shared by Daily Practice and
 * the mock papers (#166 step 4), so a question is answered the same way in
 * both. Moved here unchanged from the practice attempt page.
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import { joinParts, splitParts } from "@/lib/studentPractice";
import { cn } from "@/lib/utils";
import type { AttemptQuestion } from "@/types/learning";

/** What the controls need to know about a question: never its answer. */
export type AnswerQuestion = Pick<
  AttemptQuestion,
  | "id"
  | "questionType"
  | "optionA"
  | "optionB"
  | "optionC"
  | "optionD"
  | "answerInstruction"
  | "answerNeedsUnit"
  | "answerBlanks"
  | "answerBlankLabels"
>;

/** A chosen option: brand-400 border (3.7:1 on white, past 1.4.11's 3:1),
 *  brand fill, and the letter chip turns solid -- three cues, so "which
 *  one did I pick" never rests on colour alone. focus-within draws the
 *  keyboard ring round the whole row, not just the tiny native control. */
export function optionRowClass(selected: boolean): string {
  return cn(
    "group/option flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed text-content transition duration-200 ease-spring",
    "focus-within:shadow-focus",
    selected
      ? "border-brand-400 bg-surface-brand shadow-xs"
      : "border-line-strong bg-surface hover:border-brand-200 hover:bg-surface-brand/50",
  );
}

/** Option letter. Chosen: white on brand-700 10.3:1; otherwise brand-700 on
 *  brand-50 9.3:1. */
export function OptionLetter({ letter, selected }: { letter: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors duration-200",
        selected ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
      )}
    >
      {letter}
    </span>
  );
}

const OPTION_LETTERS: string[] = ["A", "B", "C", "D"];

type QuestionOption = { letter: string; text: string };

export function questionOptions(question: AnswerQuestion): QuestionOption[] {
  const options: QuestionOption[] = [];
  const byLetter: Record<string, string | null> = {
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD,
  };
  for (const letter of OPTION_LETTERS) {
    const text = byLetter[letter];
    if (text) options.push({ letter, text });
  }
  return options;
}

/** One question's answer control, shaped to what learning_service.grade_answer
 * actually parses (see backend/app/services/learning_service.py):
 * - Single Select: the chosen option letter, verbatim.
 * - Multi Select: chosen letters, comma-joined -- compared as a set, so
 *   order doesn't matter.
 * - Numeric/Text Entry: raw text, compared normalized (case/whitespace/
 *   comma-insensitive). This deliberately renders as ONE field even though
 *   the backend can compare a ";"-joined multi-blank answer -- Chapter 1's
 *   real content is overwhelmingly single-value, and a true multi-blank
 *   editor is tracked as a follow-up, not silently assumed unnecessary.
 * - Ordering: reordered via the up/down controls below, sent as the chosen
 *   sequence of option letters joined by ";". This is a best-effort shape
 *   (the exact real-content convention for Ordering answers wasn't
 *   available to verify against) -- questions with no lettered options fall
 *   back to a free-text sequence field instead.
 * - Anything else (Constructed Response, unrecognised types): a plain
 *   textarea. It still saves and submits, but grade_answer deliberately
 *   returns "not auto-graded" for it -- the result view marks these
 *   "Waiting for Marks" rather than right/wrong.
 */
export function QuestionInput({
  question,
  value,
  onChange,
  maxLength,
}: {
  question: AnswerQuestion;
  value: string;
  onChange: (next: string) => void;
  /** The longest answer the server keeps (mock papers: 2,000). */
  maxLength?: number;
}) {
  const options = questionOptions(question);

  if (question.questionType === "Single Select" && options.length > 0) {
    return (
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option.letter} className={optionRowClass(value === option.letter)}>
            <input
              type="radio"
              name={question.id}
              className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              checked={value === option.letter}
              onChange={() => onChange(option.letter)}
            />
            <OptionLetter letter={option.letter} selected={value === option.letter} />
            <span className="min-w-0 pt-0.5">{option.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "Multi Select" && options.length > 0) {
    const selected = new Set(
      value
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    );
    return (
      <div className="space-y-2">
        {/* content-subtle on white: 6.4:1. */}
        <p className="text-xs text-content-subtle">Choose every answer that applies.</p>
        {options.map((option) => (
          <label key={option.letter} className={optionRowClass(selected.has(option.letter))}>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              checked={selected.has(option.letter)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.letter);
                else next.delete(option.letter);
                onChange(Array.from(next).sort().join(","));
              }}
            />
            <OptionLetter letter={option.letter} selected={selected.has(option.letter)} />
            <span className="min-w-0 pt-0.5">{option.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "Ordering" && options.length > 0) {
    const order = value
      ? value
          .split(";")
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      : options.map((o) => o.letter);
    const ordered = order
      .map((letter) => options.find((o) => o.letter === letter))
      .filter((o): o is { letter: string; text: string } => Boolean(o));
    const missing = options.filter((o) => !order.includes(o.letter));
    const items = [...ordered, ...missing];

    function move(index: number, direction: -1 | 1) {
      const next = [...items.map((i) => i.letter)];
      const target = index + direction;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target]!, next[index]!];
      onChange(next.join(";"));
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-content-subtle">Put these in the right order, top to bottom.</p>
        {items.map((option, index) => (
          <div
            key={option.letter}
            className="flex items-center gap-3 rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm leading-relaxed text-content transition duration-200 ease-spring hover:border-brand-200"
          >
            {/* content-brand on surface-brand: 9.3:1. */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-xs font-bold tabular text-content-brand ring-1 ring-inset ring-brand-100">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{option.text}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label="Move down"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // #160: an answer in parts gets a box per part, saved joined with ";".
  if ((question.questionType === "Numeric Entry" || question.questionType === "Text Entry") && (question.answerBlanks ?? 1) > 1) {
    const count = question.answerBlanks ?? 1;
    const parts = splitParts(value, count);
    const labels = question.answerBlankLabels && question.answerBlankLabels.length === count ? question.answerBlankLabels : null;
    return (
      <fieldset className="space-y-2">
        <legend className="text-xs text-content-subtle">
          {labels ? "Fill in each box." : `This answer has ${count} parts. Fill in each box, in order.`}
        </legend>
        <div className="flex flex-wrap gap-3">
          {parts.map((part, index) => (
            <label key={index} className="flex flex-col gap-1 text-sm font-semibold text-content">
              {labels ? labels[index] : `Part ${index + 1}`}
              <input
                type="text"
                maxLength={maxLength}
                inputMode={question.questionType === "Numeric Entry" ? "decimal" : "text"}
                value={part}
                onChange={(event) => {
                  const next = [...parts];
                  next[index] = event.target.value;
                  onChange(joinParts(next));
                }}
                className="h-12 w-40 rounded-2xl border border-line-field bg-surface px-4 text-base font-normal tabular text-content shadow-xs outline-hidden transition placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus-field"
              />
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.questionType === "Numeric Entry") {
    // Phase 4 (#164): how a measured answer is to be written, from the
    // server ("Answer in grams." / "Write the number and the unit."). It
    // says how to answer, never what the answer is. Read out with the box.
    const instruction = question.answerInstruction;
    const instructionId = `answer-instruction-${question.id}`;
    return (
      <div className="space-y-2">
        <input
          type="text"
          maxLength={maxLength}
          // A unit to be written needs letters: a decimal keypad has none.
          inputMode={question.answerNeedsUnit ? "text" : "decimal"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type your answer"
          aria-describedby={instruction ? instructionId : undefined}
          className="h-12 w-full max-w-xs rounded-2xl border border-line-field bg-surface px-4 text-base tabular text-content shadow-xs outline-hidden transition placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus-field"
        />
        {instruction ? (
          // content-subtle on white: 6.4:1.
          <p id={instructionId} className="text-sm text-content-subtle">
            {instruction}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <textarea
      maxLength={maxLength}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={question.questionType === "Constructed Response" ? 5 : 2}
      placeholder="Type your answer"
      className="w-full rounded-2xl border border-line-field bg-surface px-4 py-3 text-base leading-relaxed text-content shadow-xs outline-hidden transition placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus-field"
    />
  );
}

/** Long enough for a Class 10 calculation set out step by step; the server
 *  holds the same limit (learning_service.WORKING_MAX_CHARS). */
const WORKING_MAX = 2000;

/**
 * "Your Working" (#163, 22 Oct 2026), under the answer on a question worth
 * 2 or more marks that is marked automatically. Optional. The answer is
 * still marked at once; the working is what a teacher reads to give marks
 * for a correct method when the answer itself lost marks.
 */
export function WorkingBox({
  question,
  value,
  disabled,
  onChange,
}: {
  question: AnswerQuestion;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const id = `working-${question.id}`;
  const hintId = `working-hint-${question.id}`;
  const nearLimit = value.length > WORKING_MAX - 200;
  return (
    <div className="space-y-1.5 border-t border-line pt-4">
      <label htmlFor={id} className="text-sm font-semibold text-content">
        Your Working <span className="font-normal text-content-subtle">(optional)</span>
      </label>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        maxLength={WORKING_MAX}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Show your steps, one per line"
        aria-describedby={hintId}
        className="w-full rounded-2xl border border-line-field bg-surface px-4 py-3 font-mono text-[0.875rem] leading-relaxed text-content shadow-xs outline-none transition placeholder:font-sans placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus-field disabled:opacity-60"
      />
      {/* content-subtle on white: 6.4:1. */}
      <p id={hintId} className="flex flex-wrap justify-between gap-x-3 text-xs text-content-subtle">
        <span>Your teacher can give marks for correct working, even if the final answer is wrong.</span>
        {nearLimit ? (
          <span className="tabular">
            {value.length} / {WORKING_MAX}
          </span>
        ) : null}
      </p>
    </div>
  );
}
