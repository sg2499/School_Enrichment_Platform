"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface CodeInputProps {
  /** The digits typed so far. Only ever digits, never longer than `length`. */
  value: string;
  onChange: (value: string) => void;
  /** Called once, the moment the last digit goes in. Typing the sixth digit
   *  is the whole of "I'm done": nobody should have to find a button to say
   *  so. Not called again until the value has changed and filled up again. */
  onComplete?: (value: string) => void;
  label: string;
  length?: number;
  disabled?: boolean;
  /** Marks the boxes as refused (coral) and tells assistive tech. */
  invalid?: boolean;
  id?: string;
  name?: string;
  "aria-describedby"?: string;
  className?: string;
}

export interface CodeInputHandle {
  focus: () => void;
}

/**
 * A one-time code, entered as one box per digit (3 Oct 2026, UI revamp
 * Phase B, slice 3).
 *
 * The two-factor step used to be an ordinary text field with "123456 or a
 * backup code" as its placeholder. A code read off a phone is checked digit
 * by digit, and six boxes let the eye do that: you can see at a glance that
 * four are in and two to go, and where a wrong one sits.
 *
 * It is ONE real input, drawn as several boxes -- not several inputs wired
 * together. That is the difference between this working and nearly working:
 *
 *   - Pasting "482 913" or "482-913" fills all six. With separate inputs a
 *     paste lands in whichever box had focus and the rest stay empty.
 *   - The phone's "code from Messages / authenticator" suggestion and a
 *     password manager's one-time-code fill both target a single field
 *     (autocomplete="one-time-code").
 *   - Backspace, select-all, and typing over a mistake behave the way a
 *     text field behaves, because it is one.
 *   - A screen reader announces one labelled field ("Authentication Code,
 *     edit text"), not six unlabelled ones.
 *
 * The input is laid over the boxes, fully transparent, so a tap anywhere
 * on the row lands in it. The caret is drawn by hand in the next empty box;
 * the real one is kept at the end of the value, which is the only place it
 * makes sense for boxes that fill left to right.
 */
export const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, label, length = 6, disabled = false, invalid = false, id, name, className, "aria-describedby": describedBy },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // The value onComplete was last told about, so a re-render with the same
  // full value (a parent's state update, say) does not submit it again.
  const announced = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  // The parent clears the boxes after a refused code. From then on the same
  // six digits are a new attempt -- pasted again, or filled in again by the
  // phone, they must submit. accept() below only sees what is typed here,
  // so a value emptied from outside has to reset the memory too.
  useEffect(() => {
    if (value.length < length) announced.current = null;
  }, [value, length]);

  function accept(raw: string) {
    // Everything that is not a digit is dropped, so "482 913", "482-913" and
    // a code pasted with a trailing newline all become the six digits.
    const digits = raw.replace(/\D/g, "").slice(0, length);
    if (digits !== value) onChange(digits);
    if (digits.length < length) {
      announced.current = null;
    } else if (announced.current !== digits) {
      announced.current = digits;
      onComplete?.(digits);
    }
  }

  function caretToEnd() {
    const input = inputRef.current;
    if (!input) return;
    // After the browser has placed its own caret (a click puts it wherever
    // the click fell inside an invisible box, which means nothing here).
    window.requestAnimationFrame(() => {
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {
        // Some input types refuse selection calls; the visible state is
        // still correct, the next keystroke simply goes where it goes.
      }
    });
  }

  const slots = Array.from({ length }, (_, index) => value[index] ?? "");
  // The box the next digit will land in. With every box full there isn't
  // one: the last box keeps the highlight so the row doesn't go dead.
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <div className={cn("group/code space-y-2", className)}>
      <label
        htmlFor={inputId}
        className={cn(
          "block text-[0.875rem] font-semibold transition-colors duration-200",
          focused ? "text-brand-700" : "text-content",
        )}
      >
        {label}
      </label>
      <div className="relative">
        {/* The boxes are decoration as far as assistive tech is concerned:
            the input below carries the label, the value and the state. */}
        <div aria-hidden className="flex gap-2 sm:gap-2.5">
          {slots.map((digit, index) => {
            const isActive = focused && index === activeIndex;
            return (
              <span
                key={index}
                className={cn(
                  "relative flex h-14 min-w-0 flex-1 items-center justify-center rounded-2xl border bg-surface shadow-xs",
                  "font-display text-[1.625rem] font-semibold tabular-nums text-content",
                  "transition duration-200 ease-spring",
                  // A wider gap after the third box: codes are read as two
                  // groups of three ("482, 913") and are easier to check
                  // that way. A margin on the box that follows, so every
                  // box keeps the same width (a margin inside a grid track
                  // would have come out of the third box instead).
                  length === 6 && index === 3 && "ml-1.5 sm:ml-2",
                  invalid
                    ? "border-coral-500"
                    : isActive
                      ? "border-brand-500 shadow-focus-field -translate-y-px"
                      : digit
                        ? "border-brand-400"
                        : "border-line-field",
                  disabled && "opacity-60",
                )}
              >
                {digit ? (
                  // Keyed by the digit so a box that is typed over replays
                  // the arrival, and one that is merely re-rendered doesn't.
                  <span key={digit} className="animate-scale-in">
                    {digit}
                  </span>
                ) : isActive ? (
                  <span className="h-6 w-0.5 rounded-full bg-brand-500 motion-safe:animate-pulse" />
                ) : null}
              </span>
            );
          })}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={length + 6}
          disabled={disabled}
          required
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => accept(event.target.value)}
          onFocus={() => {
            setFocused(true);
            caretToEnd();
          }}
          onBlur={() => setFocused(false)}
          onClick={caretToEnd}
          onKeyDown={(event) => {
            // These would move a caret nobody can see into the middle of
            // the value (Up and Home go to its start), and the next digit
            // would land there.
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "PageUp"].includes(event.key)) event.preventDefault();
          }}
          // Transparent rather than hidden: it must stay focusable, tappable
          // and fillable. caret-transparent because the caret is drawn in
          // the boxes; text-base (16px) so iOS does not zoom the page on
          // focus. The extra `maxLength` leaves room for a pasted code with
          // spaces or dashes in it, which accept() then strips.
          // `code-input` exempts it from the page-wide autofill styling
          // (globals.css), which would paint an opaque white field with
          // small text straight over the boxes.
          className="code-input absolute inset-0 h-full w-full cursor-text rounded-2xl bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
});
