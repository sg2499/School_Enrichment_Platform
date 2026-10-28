"use client";

/**
 * Sitting a mock paper (#166 step 4, 27 Oct 2026). The server keeps the
 * time; this page shows it. Reading time first (questions shown, answers
 * locked), then writing time with a countdown always in view. Every answer
 * saves as it is typed, so a dropped connection loses nothing, and when the
 * time is up the paper is handed in with what was saved. In an either/or
 * pair the student picks one question. No answers or marks show while
 * sitting; at hand-in the marks show at once (#208), and the right answers
 * and solutions once the paper closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Clock, Cloud, CloudOff, Loader2, Send } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import {
  activeHalf,
  answeredCount,
  countdownText,
  durationText,
  handedInText,
  placeAnswered,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/mockPapers";
import { formatDateTime } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { QuestionInput, WorkingBox } from "@/components/practice/AnswerInput";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { InlineLink } from "@/components/ui/InlineLink";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import type { PaperResult, SitPart, SitPlace, SitSection, SittingView } from "@/types/mockPapers";

type SaveState = "saving" | "saved" | "error";

/** The server's code for a refusal ("TIME_UP"), when there is one. */
function errorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { detail?: { code?: string } } } })?.response?.data?.detail?.code;
}
const SAVE_DELAY = 800;

function Rules({ view }: { view: SittingView }) {
  const p = view.paper;
  const choices = p.sections.reduce((n, s) => n + s.choices, 0);
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-content">
      <li>
        {p.totalMarks} marks in {p.sections.length} {p.sections.length === 1 ? "section" : "sections"}:{" "}
        {p.sections.map((s) => `${s.name} (${s.count} × ${s.marks})`).join(", ")}.
      </li>
      <li>
        {durationText(p.timeMinutes)} to answer
        {p.readingMinutes ? `, after ${p.readingMinutes} minutes' reading time, when you can read the questions but not answer yet` : ""}.
        The clock starts when you press Start and keeps going if you leave the page.
      </li>
      {choices ? <li>Where a question has an &quot;or&quot;, answer one of the two. Only the one you choose is marked.</li> : null}
      <li>
        {p.navigation === "FORWARD"
          ? "You go through the sections in order. Once you move to the next section you can't go back."
          : "You can move between the sections in any order."}
      </li>
      <li>Your answers save as you type. When the time is up, your paper is handed in with what you saved.</li>
      <li>You sit this paper once. You see your marks as soon as you hand in, and the answers and solutions once the paper closes.</li>
    </ul>
  );
}

function SavedMark({ state }: { state: SaveState | undefined }) {
  if (!state) return null;
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-content-subtle">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral-700" role="alert">
        <CloudOff className="h-3 w-3" aria-hidden /> Not saved yet. Keep going; it will try again.
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-jade-700">
      <Cloud className="h-3 w-3" aria-hidden /> Saved
    </span>
  );
}

function PartBlock({
  part,
  locked,
  value,
  working,
  saveState,
  onChange,
  onWorking,
}: {
  part: SitPart;
  locked: boolean;
  value: string;
  working: string;
  saveState: SaveState | undefined;
  onChange: (v: string) => void;
  onWorking: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-content">
        {part.label ? <span className="font-semibold">({part.label}) </span> : null}
        {part.text}
        <span className="ml-2 whitespace-nowrap text-xs text-content-subtle">
          [{part.marks} {part.marks === 1 ? "mark" : "marks"}]
        </span>
      </p>
      <fieldset disabled={locked} className={cn(locked && "opacity-60")}>
        <QuestionInput question={part} value={value} onChange={onChange} maxLength={2000} />
        {part.acceptsWorking ? (
          <div className="mt-3">
            <WorkingBox question={part} value={working} disabled={locked} onChange={onWorking} />
          </div>
        ) : null}
      </fieldset>
      <SavedMark state={saveState} />
    </div>
  );
}

function ResultView({ result }: { result: PaperResult }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-6 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">Your Marks</p>
            <p className="font-display text-display-md text-content">
              {result.score ?? result.scoreSoFar} <span className="text-content-subtle">/ {result.maxScore}</span>
            </p>
            {result.waiting ? (
              <p className="text-xs text-content-subtle">
                Your total so far: {result.waiting} written {result.waiting === 1 ? "answer is" : "answers are"} still to be marked by your
                teacher.
              </p>
            ) : null}
          </div>
          <ul className="flex flex-wrap gap-3 text-sm">
            {result.sections.map((s) => (
              <li key={s.name} className="rounded-xl bg-surface-muted px-3 py-2">
                <span className="font-semibold text-content">{s.name}</span>{" "}
                <span className="text-content-muted">
                  {s.marks} / {s.maxMarks}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      {result.solutionsOpen ? null : (
        <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-content-muted">
          The right answers and solutions show here when the paper closes, {formatDateTime(result.solutionsAt)}, once everyone has finished.
        </p>
      )}
      {result.sections.map((s) => (
        <section key={s.name} aria-label={s.name} className="space-y-3">
          <h2 className="font-display text-display-sm text-content">{s.name}</h2>
          <ol className="space-y-3">
            {s.places.map((place) => (
              <li key={place.number}>
                <Card>
                  <CardBody className="space-y-4 sm:p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
                      Question {place.number}
                      {place.choice ? " (the one you chose)" : ""}
                    </p>
                    {place.stimulus ? (
                      <p className="whitespace-pre-line rounded-xl bg-surface-brand p-3 text-sm text-content">{place.stimulus}</p>
                    ) : null}
                    {place.parts.map((part) => {
                      const full = part.score !== null && part.score === part.maxScore;
                      const waiting = part.score === null;
                      return (
                        <div key={part.id} className="space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="whitespace-pre-line text-sm text-content">
                              {part.label ? <span className="font-semibold">({part.label}) </span> : null}
                              {part.text}
                            </p>
                            <Badge
                              tone={waiting ? "neutral" : full ? "success" : part.score ? "warning" : "danger"}
                              icon={full ? <CheckCircle2 className="h-3 w-3" /> : undefined}
                            >
                              {waiting ? `Waiting for your teacher (out of ${part.maxScore})` : `${part.score} / ${part.maxScore}`}
                            </Badge>
                          </div>
                          <p className="text-sm">
                            <span className="font-semibold text-content">Your answer:</span>{" "}
                            <span className="whitespace-pre-line text-content-muted">{part.response || "Left blank"}</span>
                          </p>
                          {part.working ? (
                            <p className="text-sm">
                              <span className="font-semibold text-content">Your working:</span>{" "}
                              <span className="whitespace-pre-line text-content-muted">{part.working}</span>
                            </p>
                          ) : null}
                          {part.note ? <p className="text-sm text-saffron-800">{part.note}</p> : null}
                          {result.solutionsOpen ? (
                            <div className="space-y-1.5 rounded-xl bg-surface-muted px-3 py-2 text-sm text-content-muted">
                              <p>
                                <span className="font-semibold text-content">Answer:</span>{" "}
                                {part.questionType === "Single Select"
                                  ? `${part.correctAnswer}. ${part[`option${part.correctAnswer}` as "optionA"] ?? ""}`
                                  : part.correctAnswer}
                              </p>
                              {part.markingSteps ? (
                                <p className="whitespace-pre-line">
                                  <span className="font-semibold text-content">How the marks are given:</span> {part.markingSteps}
                                </p>
                              ) : null}
                              {part.explanation ? (
                                <p className="whitespace-pre-line">
                                  <span className="font-semibold text-content">Explanation:</span> {part.explanation}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Place({
  place,
  locked,
  answers,
  working,
  saves,
  onAnswer,
  onWorking,
  onChoose,
}: {
  place: SitPlace;
  locked: boolean;
  answers: Record<string, string>;
  working: Record<string, string>;
  saves: Record<string, SaveState>;
  onAnswer: (id: string, v: string) => void;
  onWorking: (id: string, v: string) => void;
  onChoose: (slotId: string) => void;
}) {
  const active = activeHalf(place);
  const done = placeAnswered(place, answers);
  return (
    <li id={`q-${place.number}`} className="scroll-mt-28">
      <Card>
        <CardBody className="space-y-4 sm:p-5">
          <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-content-subtle">
            <span>
              Question {place.number} · {place.marks} {place.marks === 1 ? "mark" : "marks"}
            </span>
            {done ? (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-jade-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Answered
              </span>
            ) : null}
          </p>
          {place.choiceGroup ? (
            <p className="text-sm text-content-muted">Answer one of these two. Only the one you choose is marked.</p>
          ) : null}
          {place.halves.map((half, i) => {
            const chosen = active?.slotId === half.slotId;
            return (
              <div
                key={half.slotId}
                className={cn("space-y-4", place.choiceGroup && "rounded-2xl border p-4", chosen ? "border-brand-300" : "border-line")}
              >
                {place.choiceGroup ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-content">{i === 0 ? "Either" : "Or"}</span>
                    {chosen ? (
                      <Badge tone="brand">Your choice</Badge>
                    ) : (
                      <Button type="button" size="sm" variant="tinted" disabled={locked} onClick={() => onChoose(half.slotId)}>
                        Answer This One
                      </Button>
                    )}
                  </div>
                ) : null}
                {half.stimulus ? (
                  <p className="whitespace-pre-line rounded-xl bg-surface-brand p-3 text-sm text-content">{half.stimulus}</p>
                ) : null}
                {half.parts.map((part) => (
                  <PartBlock
                    key={part.id}
                    part={part}
                    locked={locked || (Boolean(place.choiceGroup) && !chosen)}
                    value={answers[part.id] ?? ""}
                    working={working[part.id] ?? ""}
                    saveState={saves[part.id]}
                    onChange={(v) => onAnswer(part.id, v)}
                    onWorking={(v) => onWorking(part.id, v)}
                  />
                ))}
              </div>
            );
          })}
        </CardBody>
      </Card>
    </li>
  );
}

export function SitPaper({ paperId }: { paperId: string }) {
  const loaded = useApiQuery<SittingView>(`/my-papers/${paperId}`, {}, { action: "open this paper" });
  const [view, setView] = useState<SittingView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, string>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmNext, setConfirmNext] = useState(false);
  const timers = useRef<Record<string, number>>({});
  const pending = useRef<Set<string>>(new Set());
  const handingIn = useRef(false);

  const adopt = useCallback((next: SittingView) => {
    setView(next);
    if (next.sitting) setOffset(Date.parse(next.sitting.serverNow) - Date.now());
    const a: Record<string, string> = {};
    const wk: Record<string, string> = {};
    for (const s of next.sections)
      for (const pl of s.places)
        for (const h of pl.halves)
          for (const p of h.parts) {
            a[p.id] = p.response ?? "";
            wk[p.id] = p.working ?? "";
          }
    setAnswers(a);
    setWorking(wk);
    if (next.sitting && next.paper.navigation === "FORWARD") setTab(next.sitting.sectionIndex);
  }, []);

  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;

  useEffect(() => {
    if (loaded.data && !view) adopt(loaded.data);
  }, [loaded.data, view, adopt]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const answersRef = useRef(answers);
  const workingRef = useRef(working);
  answersRef.current = answers;
  workingRef.current = working;

  // Each save sends the answer and the working together (the server keeps
  // working only where a question takes it).
  // Saves in flight, so handing in waits for them (review).
  const inflight = useRef<Record<string, Promise<void>>>({});

  const save = useCallback(
    (questionId: string): Promise<void> => {
      const run = saveNow(questionId);
      inflight.current[questionId] = run;
      void run.finally(() => {
        if (inflight.current[questionId] === run) delete inflight.current[questionId];
      });
      return run;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paperId],
  );

  const saveNow = async (questionId: string) => {
    pending.current.delete(questionId);
    setSaves((s) => ({ ...s, [questionId]: "saving" }));
    try {
      const { data } = await api.put<{ chosenSlotId: string | null }>(`/my-papers/${paperId}/answers`, {
        questionId,
        response: answersRef.current[questionId] ?? "",
        working: workingRef.current[questionId] ?? "",
        workingSent: true,
      });
      setSaves((s) => ({ ...s, [questionId]: "saved" }));
      if (data.chosenSlotId) {
        setView((v) =>
          v
            ? {
                ...v,
                sections: v.sections.map((sec) => ({
                  ...sec,
                  places: sec.places.map((pl) =>
                    pl.halves.some((h) => h.slotId === data.chosenSlotId) ? { ...pl, chosenSlotId: data.chosenSlotId } : pl,
                  ),
                })),
              }
            : v,
        );
      }
    } catch (err) {
      const described = describeApiError(err, "save your answer");
      setSaves((s) => ({ ...s, [questionId]: "error" }));
      if (["TIME_UP", "HANDED_IN"].includes(errorCode(err) ?? "")) {
        setProblem(described.message);
        pending.current.clear();
        const fresh = await api.get<SittingView>(`/my-papers/${paperId}`).catch(() => null);
        if (fresh) adoptRef.current(fresh.data);
      } else if (described.retryable) {
        pending.current.add(questionId); // a dropped connection: tried again
      } else {
        setProblem(described.message); // refused (too long, say): trying again won't help
      }
    }
  };

  const schedule = useCallback(
    (questionId: string) => {
      pending.current.add(questionId);
      window.clearTimeout(timers.current[questionId]);
      timers.current[questionId] = window.setTimeout(() => void save(questionId), SAVE_DELAY);
    },
    [save],
  );

  const flush = useCallback(async () => {
    const ids = [...pending.current];
    for (const id of ids) window.clearTimeout(timers.current[id]);
    await Promise.all([...ids.map((id) => save(id)), ...Object.values(inflight.current)]);
  }, [save]);

  // Retry unsaved answers every so often (a dropped connection).
  const savesRef = useRef(saves);
  savesRef.current = saves;
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const q of [...pending.current]) if (savesRef.current[q] === "error") void save(q);
    }, 15000);
    return () => window.clearInterval(id);
  }, [save]);

  const handIn = useCallback(async () => {
    if (handingIn.current) return;
    handingIn.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await flush();
      const { data } = await api.post<SittingView>(`/my-papers/${paperId}/submit`);
      adopt(data);
    } catch (err) {
      // Time already up: the server has handed it in.
      const { data } = await api.get<SittingView>(`/my-papers/${paperId}`).catch(() => ({ data: null as SittingView | null }));
      if (data && data.sitting?.status === "SUBMITTED") adopt(data);
      else setProblem(describeApiError(err, "hand in your paper").message);
    } finally {
      setBusy(false);
      setConfirmSubmit(false);
      handingIn.current = false;
    }
  }, [flush, paperId, adopt]);

  const sitting = view?.sitting ?? null;
  const serverNow = now + offset;
  const deadline = sitting ? Date.parse(sitting.deadlineAt) : 0;
  const writingAt = sitting ? Date.parse(sitting.writingStartsAt) : 0;
  const inProgress = sitting?.status === "IN_PROGRESS";
  const reading = inProgress && serverNow < writingAt;

  // At the end of the time: one automatic hand-in. If that fails (no
  // connection), the Hand In button stays for the student (review).
  const autoTried = useRef(false);
  useEffect(() => {
    if (inProgress && serverNow >= deadline && !autoTried.current) {
      autoTried.current = true;
      void handIn();
    }
  }, [inProgress, serverNow, deadline, handIn]);

  // #208: a handed-in result can still change (a written answer marked, the
  // solutions opening at the close), so it is looked at again every minute
  // until it is final, and when the student comes back to the tab.
  const result = view?.result ?? null;
  const settled = !result || (result.waiting === 0 && result.solutionsOpen);
  useEffect(() => {
    if (settled) return;
    const again = async () => {
      try {
        const { data } = await api.get<SittingView>(`/my-papers/${paperId}`);
        adoptRef.current(data);
      } catch {
        // A missed refresh is tried again in a minute.
      }
    };
    const timer = window.setInterval(again, 60_000);
    const onFocus = () => document.visibilityState === "visible" && void again();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [settled, paperId]);

  if (loaded.problem) return <LoadError problem={loaded.problem} onRetry={loaded.reload} />;
  if (!view) return <TableSkeleton label="Opening the paper" rows={4} />;

  const p = view.paper;
  const header = (
    <PageHeader
      surface="masthead"
      eyebrow="Mock Paper"
      title={p.title}
      back={
        <InlineLink href="/student/papers" direction="back" tone="inverse" size="sm">
          Mock Papers
        </InlineLink>
      }
      meta={
        <Badge tone={STATUS_TONE[p.status]} onDark>
          {STATUS_LABEL[p.status]}
        </Badge>
      }
      facts={[
        { label: "Marks", value: p.totalMarks },
        { label: "Time", value: `${durationText(p.timeMinutes)}${p.readingMinutes ? ` + ${p.readingMinutes} min reading` : ""}` },
        { label: "Closes", value: formatDateTime(p.closesAt) },
      ]}
    />
  );

  if (!sitting) {
    const open = p.status === "OPEN";
    return (
      <div className="space-y-8">
        {header}
        <Card>
          <CardBody className="space-y-5 sm:p-7">
            <h2 className="font-display text-display-sm text-content">Before You Start</h2>
            <Rules view={view} />
            {problem ? <AlertBanner tone="error" message={problem} /> : null}
            {open ? (
              <Button
                type="button"
                variant="primary"
                loading={busy}
                loadingLabel="Starting"
                leadingIcon={<Clock className="h-4 w-4" />}
                onClick={async () => {
                  setBusy(true);
                  setProblem(null);
                  try {
                    const { data } = await api.post<SittingView>(`/my-papers/${paperId}/start`);
                    adopt(data);
                  } catch (err) {
                    setProblem(describeApiError(err, "start this paper").message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Start the Paper
              </Button>
            ) : (
              <AlertBanner
                tone="info"
                message={p.status === "SCHEDULED" ? `This paper opens on ${formatDateTime(p.opensAt)}.` : "This paper has closed."}
              />
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!inProgress) {
    return (
      <div className="space-y-8">
        {header}
        {view.result ? (
          <>
            <p className="flex items-center gap-2 text-sm text-content-muted">
              <CheckCircle2 className="h-4 w-4 text-jade-600" aria-hidden /> {handedInText(sitting.submittedHow)}
            </p>
            <ResultView result={view.result} />
          </>
        ) : (
          <Card>
            <CardBody className="space-y-2 sm:p-7">
              <p className="flex items-center gap-2 font-semibold text-content">
                <CheckCircle2 className="h-5 w-5 text-jade-600" aria-hidden /> Handed In
              </p>
              <p className="text-sm text-content-muted">{handedInText(sitting.submittedHow)}</p>
              <p className="text-sm text-content-muted">Your marks will show here. If they don&apos;t, open this page again.</p>
            </CardBody>
          </Card>
        )}
      </div>
    );
  }

  const sections: SitSection[] = view.sections;
  const forward = p.navigation === "FORWARD";
  const shown = sections[tab] ?? sections[0];
  const { answered, total } = answeredCount(sections, answers);
  const left = reading ? writingAt - serverNow : deadline - serverNow;
  const lastMinutes = !reading && left < 5 * 60 * 1000;

  return (
    <div className="space-y-6">
      {header}
      <div
        className={cn(
          "sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm",
          reading ? "border-line-brand bg-surface-brand" : lastMinutes ? "border-coral-200 bg-coral-50" : "border-line bg-surface",
        )}
        role="timer"
        aria-live="off"
      >
        <span className="text-sm font-semibold text-content">
          {reading ? "Reading time: answering starts in " : "Time left: "}
          <span className={cn("tabular text-base", lastMinutes && "text-coral-800")}>{countdownText(left)}</span>
        </span>
        <span className="text-sm text-content-muted">
          {answered} of {total} answered
        </span>
        <Button
          type="button"
          size="sm"
          variant="primary"
          leadingIcon={<Send className="h-4 w-4" />}
          disabled={reading || busy}
          onClick={() => setConfirmSubmit(true)}
        >
          Hand In
        </Button>
      </div>
      {problem ? <AlertBanner tone="error" message={problem} /> : null}
      {reading ? <AlertBanner tone="info" message="Read the questions now. You can start answering when reading time ends." /> : null}

      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {sections.map((s, i) => {
          const done = s.places.filter((pl) => placeAnswered(pl, answers)).length;
          const reachable = !forward || i === tab;
          return (
            <button
              key={s.index}
              type="button"
              disabled={!reachable}
              aria-current={i === tab ? "step" : undefined}
              onClick={() => setTab(i)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left text-sm transition",
                i === tab
                  ? "border-brand-400 bg-surface-brand font-semibold text-content"
                  : "border-line bg-surface text-content-muted hover:bg-surface-muted",
                !reachable && "cursor-not-allowed opacity-50",
              )}
            >
              {s.name}
              <span className="block text-xs font-normal text-content-subtle">
                {done} of {s.places.length} answered
              </span>
            </button>
          );
        })}
      </nav>

      <section aria-labelledby="section-heading" className="space-y-3">
        <h2 id="section-heading" className="font-display text-display-sm text-content">
          {shown.name}
          <span className="ml-2 text-sm font-normal text-content-subtle">
            {shown.count} × {shown.marks} {shown.marks === 1 ? "mark" : "marks"}
          </span>
        </h2>
        <ol className="space-y-3">
          {shown.places.map((place) => (
            <Place
              key={place.number}
              place={place}
              locked={reading}
              answers={answers}
              working={working}
              saves={saves}
              onAnswer={(id, v) => {
                setAnswers((a) => ({ ...a, [id]: v }));
                schedule(id);
              }}
              onWorking={(id, v) => {
                setWorking((w) => ({ ...w, [id]: v }));
                schedule(id);
              }}
              onChoose={async (slotId) => {
                setProblem(null);
                try {
                  await api.post(`/my-papers/${paperId}/choose`, { slotId });
                  setView((v) =>
                    v
                      ? {
                          ...v,
                          sections: v.sections.map((sec) => ({
                            ...sec,
                            places: sec.places.map((pl) =>
                              pl.halves.some((h) => h.slotId === slotId) ? { ...pl, chosenSlotId: slotId } : pl,
                            ),
                          })),
                        }
                      : v,
                  );
                } catch (err) {
                  setProblem(describeApiError(err, "choose this question").message);
                }
              }}
            />
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        {forward && tab < sections.length - 1 ? (
          <Button type="button" variant="secondary" disabled={reading} onClick={() => setConfirmNext(true)}>
            Next Section
          </Button>
        ) : null}
        {!forward && tab < sections.length - 1 ? (
          <Button type="button" variant="secondary" onClick={() => setTab(tab + 1)}>
            Next Section
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          leadingIcon={<Send className="h-4 w-4" />}
          disabled={reading || busy}
          onClick={() => setConfirmSubmit(true)}
        >
          Hand In
        </Button>
      </div>

      <Modal
        open={confirmSubmit}
        onClose={() => (busy ? undefined : setConfirmSubmit(false))}
        title="Hand In Your Paper?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmSubmit(false)}>
              Keep Working
            </Button>
            <Button variant="primary" loading={busy} loadingLabel="Handing in" onClick={() => void handIn()}>
              Hand In
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            You have answered {answered} of {total} questions.
            {answered < total ? " Questions left blank get no marks." : ""}
          </p>
          {answered < total ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Questions not answered">
              {sections.flatMap((s) =>
                s.places
                  .filter((pl) => !placeAnswered(pl, answers))
                  .map((pl) => (
                    <li
                      key={pl.number}
                      className="inline-flex items-center gap-1 rounded-lg bg-coral-50 px-2 py-1 text-xs font-semibold text-coral-800"
                    >
                      <CircleAlert className="h-3 w-3" aria-hidden /> {pl.number}
                    </li>
                  )),
              )}
            </ul>
          ) : null}
          <p className="text-content-muted">After handing in you can&apos;t change your answers.</p>
        </div>
      </Modal>

      <Modal
        open={confirmNext}
        onClose={() => setConfirmNext(false)}
        title="Move to the Next Section?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNext(false)}>
              Stay Here
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                setProblem(null);
                try {
                  await flush();
                  const { data } = await api.post<SittingView>(`/my-papers/${paperId}/next-section`);
                  adopt(data);
                  setTab(data.sitting?.sectionIndex ?? tab + 1);
                  window.scrollTo({ top: 0 });
                } catch (err) {
                  setProblem(describeApiError(err, "move to the next section").message);
                } finally {
                  setConfirmNext(false);
                }
              }}
            >
              Move On
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">On this paper you can&apos;t come back to {shown.name} once you move on.</p>
      </Modal>
    </div>
  );
}
