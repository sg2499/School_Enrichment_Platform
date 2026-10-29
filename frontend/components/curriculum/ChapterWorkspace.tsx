"use client";

/**
 * One chapter, for the Super Admin (#212, 29 Oct 2026): its own page, in
 * three views (?view=):
 *
 *   Overview   where the chapter stands, its next step, and bulk approval
 *   Lessons    every lesson with its review progress and status step
 *   Questions  one lesson at a time (?lesson=), every question to read,
 *              filtered by what still needs a decision
 *
 * It replaced a full-screen pop-up that held the lessons and, expanded in
 * place, up to 500 question cards.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { QuestionCard } from "@/components/curriculum/QuestionCard";
import { CHAPTER_STATUS_TONE, ErrorBanner, LESSON_STATUS_TONE, LIST_KEY, STATUS_LABEL, countOf } from "@/components/curriculum/shared";
import { LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { SelectField } from "@/components/ui/Field";
import { FilterChips } from "@/components/ui/FilterChips";
import { InlineLink } from "@/components/ui/InlineLink";
import { Modal } from "@/components/ui/Modal";
import { MastheadSkeleton, PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SearchInput } from "@/components/ui/SearchInput";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { api, errorMessage } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { cn } from "@/lib/utils";
import type {
  BulkApproveResult,
  ChapterDetail,
  ChapterStatus,
  ConceptLessonStatus,
  ConceptLessonSummary,
  QuestionDetail,
  QuestionStatus,
} from "@/types/curriculum";

type View = "overview" | "lessons" | "questions";

const NEXT_STEP: Record<ChapterStatus, string> = {
  DRAFT: "Read its lessons and approve their questions, then send the chapter to review.",
  REVIEW: "When its lessons and questions are right, publish it. Schools can then add it to their calendars.",
  PUBLISHED: "Schools can add it to their calendars. Archive it to take it out of use; schools keep what they already have.",
  ARCHIVED: "Out of use. Restore it to Draft to work on it again.",
};

const LADDER: ChapterStatus[] = ["DRAFT", "REVIEW", "PUBLISHED"];

function reviewOf(lessons: ConceptLessonSummary[]) {
  return lessons.reduce(
    (t, l) => ({
      questions: t.questions + l.questionCount,
      approved: t.approved + (l.review?.approved ?? 0),
      inReview: t.inReview + (l.review?.inReview ?? 0),
      flagged: t.flagged + (l.review?.flagged ?? 0),
    }),
    { questions: 0, approved: 0, inReview: 0, flagged: 0 },
  );
}

function ApprovalBar({ approved, inReview, total }: { approved: number; inReview: number; total: number }) {
  return (
    <ProgressBar
      total={total}
      segments={[
        { value: approved, label: "approved", className: "bg-jade-500" },
        { value: inReview, label: "in review", className: "bg-saffron-400" },
      ]}
    />
  );
}

/** Draft -> In Review -> Published, with where the chapter is. */
function Ladder({ status }: { status: ChapterStatus }) {
  if (status === "ARCHIVED") {
    return (
      <Badge tone="danger" dot>
        Archived
      </Badge>
    );
  }
  const at = LADDER.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={`Chapter status: ${STATUS_LABEL[status]}`}>
      {LADDER.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
              i < at && "bg-jade-50 text-jade-800 ring-1 ring-inset ring-jade-200",
              i === at && "bg-brand-gradient text-content-inverse shadow-brand",
              i > at && "bg-surface-muted text-content-subtle ring-1 ring-inset ring-line",
            )}
          >
            {i < at ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
            {STATUS_LABEL[step]}
          </span>
          {i < LADDER.length - 1 ? <ChevronRight className="h-4 w-4 text-content-faint" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function StatusCard({ chapter, onChanged }: { chapter: ChapterDetail; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState<ChapterStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lessons = chapter.conceptLessons;
  const publishedLessons = lessons.filter((l) => l.status === "PUBLISHED").length;
  const r = reviewOf(lessons);

  async function move(status: ChapterStatus) {
    setPending(status);
    setProblem(null);
    try {
      await api.patch(`/curriculum-admin/chapters/${chapter.id}/status`, { status });
      await onChanged();
    } catch (err) {
      setProblem(errorMessage(err, "update this chapter's status"));
    } finally {
      setPending(null);
    }
  }

  const step = (status: ChapterStatus, label: string, icon: React.ReactNode, variant: "accent" | "secondary" | "ghost") => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      leadingIcon={icon}
      loading={pending === status}
      disabled={pending !== null && pending !== status}
      onClick={() => void move(status)}
    >
      {label}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1.5">
        <CardTitle>Where It Stands</CardTitle>
        <CardDescription>{NEXT_STEP[chapter.status]}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-5">
        <Ladder status={chapter.status} />
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <dt className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Lessons Published</dt>
            <dd className="space-y-1.5">
              <ProgressBar total={lessons.length} segments={[{ value: publishedLessons, label: "published", className: "bg-jade-500" }]} />
              <p className="text-sm text-content tabular">
                {publishedLessons} of {countOf(lessons.length, "lesson")}
              </p>
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Questions Approved</dt>
            <dd className="space-y-1.5">
              <ApprovalBar approved={r.approved} inReview={r.inReview} total={r.questions} />
              <p className="flex flex-wrap items-center gap-2 text-sm text-content tabular">
                {r.approved.toLocaleString("en-IN")} of {countOf(r.questions, "question")}
                {r.flagged ? (
                  <Badge tone="danger" size="sm">
                    {r.flagged} flagged
                  </Badge>
                ) : null}
              </p>
            </dd>
          </div>
        </dl>
        {problem ? <ErrorBanner message={problem} /> : null}
        <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
          {chapter.status === "DRAFT" ? step("REVIEW", "Send to Review", <Send className="h-4 w-4" />, "secondary") : null}
          {chapter.status === "REVIEW" ? (
            <>
              {step("PUBLISHED", "Publish Chapter", <CheckCircle2 className="h-4 w-4" />, "accent")}
              {step("DRAFT", "Send Back to Draft", <RotateCcw className="h-4 w-4" />, "ghost")}
            </>
          ) : null}
          {chapter.status === "PUBLISHED" ? step("ARCHIVED", "Archive", <Archive className="h-4 w-4" />, "ghost") : null}
          {chapter.status === "ARCHIVED" ? step("DRAFT", "Restore to Draft", <RotateCcw className="h-4 w-4" />, "secondary") : null}
        </div>
      </CardBody>
    </Card>
  );
}

/** Bulk approval for the chapter or one lesson: verified only, or verified and unverified (asked once). */
function BulkApprove({
  path,
  scopeLabel,
  onDone,
  compact,
}: {
  path: string;
  scopeLabel: string;
  onDone: () => Promise<void>;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"verified" | "unverified" | null>(null);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<BulkApproveResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(includeUnverified: boolean) {
    setMode(includeUnverified ? "unverified" : "verified");
    setResult(null);
    setProblem(null);
    try {
      const { data } = await api.post<BulkApproveResult>(path, { includeUnverified });
      setResult(data);
      setAsking(false);
      await onDone();
    } catch (err) {
      setProblem(errorMessage(err, `approve ${scopeLabel}'s questions`));
      setAsking(false);
    } finally {
      setMode(null);
    }
  }

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        leadingIcon={<ShieldCheck className="h-4 w-4" />}
        loading={mode === "verified"}
        loadingLabel="Checking and approving"
        disabled={mode === "unverified"}
        onClick={() => void run(false)}
      >
        Approve All Verified
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        leadingIcon={<ShieldAlert className="h-4 w-4" />}
        disabled={mode !== null}
        onClick={() => setAsking(true)}
      >
        Also Approve Unverified…
      </Button>
    </div>
  );

  const outcome = result ? (
    <p role="status" className="text-xs leading-relaxed text-content-muted">
      Approved <strong className="text-jade-700">{result.approvedCount}</strong>.
      {result.skippedFlaggedCount > 0 ? ` ${result.skippedFlaggedCount} flagged, left for you to read.` : ""}
      {result.skippedUnverifiedCount > 0 ? ` ${result.skippedUnverifiedCount} couldn't be checked automatically.` : ""}
      {result.skippedAlreadyDoneCount > 0 ? ` ${result.skippedAlreadyDoneCount} already approved or published.` : ""}
    </p>
  ) : null;

  const confirm = (
    <Modal
      open={asking}
      onClose={() => (mode ? undefined : setAsking(false))}
      size="sm"
      title="Also Approve Unverified Questions?"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={mode !== null} onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button type="button" loading={mode === "unverified"} loadingLabel="Approving" onClick={() => void run(true)}>
            Approve Verified and Unverified
          </Button>
        </>
      }
    >
      <p className="text-sm text-content">
        This also approves {scopeLabel}&apos;s questions that no automated check could confirm: their answer keys have only the import
        behind them. Flagged questions are still left out, and any approved question can be sent back later.
      </p>
    </Modal>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        {buttons}
        {outcome}
        {problem ? <ErrorBanner message={problem} /> : null}
        {confirm}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1.5">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
          Approve in Bulk
        </CardTitle>
        <CardDescription>
          Runs the automated checks over every question in the chapter and approves the ones they confirm. Flagged questions, and those no
          check can confirm either way, are left for you to read one by one under Questions.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {buttons}
        {outcome}
        {problem ? <ErrorBanner message={problem} /> : null}
      </CardBody>
      {confirm}
    </Card>
  );
}

function LessonsView({
  chapter,
  onChanged,
  questionsHref,
}: {
  chapter: ChapterDetail;
  onChanged: () => Promise<void>;
  questionsHref: (lessonId: string) => string;
}) {
  const [pending, setPending] = useState<{ id: string; status: ConceptLessonStatus } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function move(lessonId: string, status: ConceptLessonStatus) {
    setPending({ id: lessonId, status });
    setProblem(null);
    try {
      await api.patch(`/curriculum-admin/concept-lessons/${lessonId}/status`, { status });
      await onChanged();
    } catch (err) {
      setProblem(errorMessage(err, "update this lesson's status"));
    } finally {
      setPending(null);
    }
  }

  if (chapter.conceptLessons.length === 0) {
    return <p className="text-sm text-content-subtle">This chapter has no lessons.</p>;
  }
  return (
    <div className="space-y-4">
      {problem ? <ErrorBanner message={problem} /> : null}
      <Table caption="Lessons" minWidth="56rem">
        <THead>
          <TH className="w-12">No.</TH>
          <TH>Lesson</TH>
          <TH align="right">Questions</TH>
          <TH className="w-52">Approved</TH>
          <TH>Status</TH>
          <TH align="right">
            <span className="sr-only">Actions</span>
          </TH>
        </THead>
        <TBody>
          {chapter.conceptLessons.map((l, i) => {
            const busy = pending?.id === l.id ? pending.status : null;
            const btn = (status: ConceptLessonStatus, label: string, variant: "secondary" | "ghost") => (
              <Button
                type="button"
                size="sm"
                aria-label={`${label}: ${l.title}`}
                variant={variant}
                loading={busy === status}
                disabled={busy !== null && busy !== status}
                onClick={() => void move(l.id, status)}
              >
                {label}
              </Button>
            );
            return (
              <TR key={l.id}>
                <TD className="tabular text-content-subtle">{i + 1}</TD>
                <TD>
                  <span className="font-semibold text-content">{l.title}</span>
                  <span className="block text-xs text-content-subtle">{l.code}</span>
                </TD>
                <TD align="right" className="tabular">
                  {l.questionCount}
                </TD>
                <TD>
                  <div className="space-y-1.5">
                    <ApprovalBar approved={l.review?.approved ?? 0} inReview={l.review?.inReview ?? 0} total={l.questionCount} />
                    <p className="flex items-center gap-2 text-xs text-content-subtle tabular">
                      {l.review?.approved ?? 0} of {l.questionCount}
                      {l.review?.flagged ? (
                        <Badge tone="danger" size="sm">
                          {l.review.flagged} flagged
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                </TD>
                <TD>
                  <Badge tone={LESSON_STATUS_TONE[l.status]} size="sm">
                    {STATUS_LABEL[l.status]}
                  </Badge>
                </TD>
                <TD align="right">
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <InlineLink href={questionsHref(l.id)} size="sm" aria-label={`Questions in ${l.title}`}>
                      Questions
                    </InlineLink>
                    {l.status === "DRAFT" ? btn("REVIEW", "Send to Review", "ghost") : null}
                    {l.status === "REVIEW" ? (
                      <>
                        {btn("PUBLISHED", "Publish", "secondary")}
                        {btn("DRAFT", "Back to Draft", "ghost")}
                      </>
                    ) : null}
                  </span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

type QuestionFilter = "all" | "flagged" | "waiting" | "approved";

function QuestionsView({
  chapter,
  lessonId,
  lessonHref,
  onChanged,
}: {
  chapter: ChapterDetail;
  lessonId: string;
  lessonHref: (id: string) => string;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const lesson = chapter.conceptLessons.find((l) => l.id === lessonId) ?? chapter.conceptLessons[0];
  const [questions, setQuestions] = useState<QuestionDetail[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuestionFilter>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ id: string; status: QuestionStatus } | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const currentId = lesson?.id ?? "";
  // Only the newest request for the lesson on screen is shown: switching
  // lessons quickly must never put one lesson's questions under another's
  // heading (review, 29 Oct).
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!currentId) return;
    const ticket = ++latest.current;
    setProblem(null);
    try {
      const { data } = await api.get<{ questions: QuestionDetail[] }>(`/curriculum-admin/concept-lessons/${currentId}/questions`);
      if (ticket === latest.current) setQuestions(data.questions);
    } catch (err) {
      if (ticket === latest.current) setProblem(errorMessage(err, "load this lesson's questions"));
    }
  }, [currentId]);

  // A new lesson starts fresh; the same lesson refreshed after an action
  // keeps its filter, search and scroll.
  useEffect(() => {
    setQuestions(null);
    setFilter("all");
    setQuery("");
    void load();
  }, [load]);

  async function advance(questionId: string, status: QuestionStatus) {
    setPending({ id: questionId, status });
    setProblem(null);
    try {
      await api.patch(`/curriculum-admin/questions/${questionId}/status`, { status });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setProblem(errorMessage(err, "update this question's status"));
    } finally {
      setPending(null);
    }
  }

  async function recheck() {
    if (!lesson) return;
    setRechecking(true);
    setProblem(null);
    try {
      const ticket = ++latest.current;
      const { data } = await api.post<{ questions: QuestionDetail[] }>(
        `/curriculum-admin/concept-lessons/${lesson.id}/questions/recheck-quality`,
      );
      if (ticket === latest.current) setQuestions(data.questions);
      await onChanged();
    } catch (err) {
      setProblem(errorMessage(err, "re-run the checks"));
    } finally {
      setRechecking(false);
    }
  }

  const all = questions ?? [];
  const counts = {
    all: all.length,
    flagged: all.filter((q) => q.qualityStatus === "FLAGGED").length,
    waiting: all.filter((q) => q.status === "DRAFT" || q.status === "SME_REVIEW").length,
    approved: all.filter((q) => q.status === "APPROVED" || q.status === "PUBLISHED").length,
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((q) => {
    if (filter === "flagged" && q.qualityStatus !== "FLAGGED") return false;
    if (filter === "waiting" && !(q.status === "DRAFT" || q.status === "SME_REVIEW")) return false;
    if (filter === "approved" && !(q.status === "APPROVED" || q.status === "PUBLISHED")) return false;
    const text = `${q.code} ${q.stem} ${q.correctAnswer} ${q.questionType}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  if (!lesson) return <p className="text-sm text-content-subtle">This chapter has no lessons.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SelectField
        label="Lesson"
        containerClassName="lg:hidden"
        value={lesson.id}
        onChange={(e) => router.push(lessonHref(e.target.value), { scroll: false })}
      >
        {chapter.conceptLessons.map((l, i) => (
          <option key={l.id} value={l.id}>
            {i + 1}. {l.title} ({l.review?.approved ?? 0} of {l.questionCount} approved)
          </option>
        ))}
      </SelectField>
      <nav aria-label="Lessons" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <ol className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
          {chapter.conceptLessons.map((l, i) => {
            const current = l.id === lesson.id;
            return (
              <li key={l.id}>
                <InlineLessonLink href={lessonHref(l.id)} current={current}>
                  <span className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[0.6875rem] font-bold tabular",
                        current ? "bg-white/20 text-white" : "bg-brand-50 text-brand-700",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-semibold leading-snug">{l.title}</span>
                      <span className={cn("block text-[0.6875rem] tabular", current ? "text-white/80" : "text-content-subtle")}>
                        {l.review?.approved ?? 0} of {l.questionCount} approved
                        {l.review?.flagged ? ` · ${l.review.flagged} flagged` : ""}
                      </span>
                    </span>
                  </span>
                </InlineLessonLink>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-content">{lesson.title}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-subtle">
              {lesson.code} · {countOf(lesson.questionCount, "question")}
              <Badge tone={LESSON_STATUS_TONE[lesson.status]} size="sm">
                {STATUS_LABEL[lesson.status]}
              </Badge>
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leadingIcon={<RefreshCw className="h-4 w-4" />}
            loading={rechecking}
            loadingLabel="Checking"
            onClick={() => void recheck()}
          >
            Re-run Checks
          </Button>
        </div>
        <BulkApprove
          key={lesson.id}
          compact
          path={`/curriculum-admin/concept-lessons/${lesson.id}/questions/bulk-approve`}
          scopeLabel="this lesson"
          onDone={async () => {
            await Promise.all([load(), onChanged()]);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <FilterChips
            label="Which questions"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: questions ? counts.all : null },
              { value: "waiting", label: "Waiting for a Decision", count: questions ? counts.waiting : null },
              { value: "flagged", label: "Flagged", count: questions ? counts.flagged : null },
              { value: "approved", label: "Approved", count: questions ? counts.approved : null },
            ]}
          />
          <SearchInput
            value={query}
            onSearch={setQuery}
            label="Search this lesson's questions"
            placeholder="Text, answer or code"
            delayMs={150}
            className="w-full sm:w-72"
          />
        </div>
        {problem ? <ErrorBanner message={problem} /> : null}
        {questions === null && !problem ? (
          <TableSkeleton label="Loading questions" rows={4} />
        ) : shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-content-subtle">
            {all.length === 0 ? "No questions in this lesson yet." : "No question matches that."}
          </p>
        ) : (
          <div className="grid gap-3 2xl:grid-cols-2">
            {shown.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                pendingStatus={pending?.id === q.id ? pending.status : null}
                onAdvance={(status) => void advance(q.id, status)}
                onMarkingSaved={(updated) => setQuestions((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineLessonLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={current ? "page" : undefined}
      className={cn(
        "block rounded-xl px-3 py-2.5 transition",
        current ? "bg-brand-gradient text-content-inverse shadow-brand" : "text-content hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}

export function ChapterWorkspace({ chapterId }: { chapterId: string }) {
  const pathname = usePathname();
  const url = useUrlState();
  const query = useApiQuery<ChapterDetail>(`/curriculum-admin/chapters/${chapterId}`, {}, { action: "open this chapter" });
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  useEffect(() => {
    if (query.data) setChapter(query.data);
  }, [query.data]);

  // A refresh that callers can wait on: the detail, straight from the server.
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<ChapterDetail>(`/curriculum-admin/chapters/${chapterId}`);
      setChapter(data);
      setRefreshProblem(null);
    } catch (err) {
      // The change was made; only the refreshed figures couldn't be read.
      setRefreshProblem(errorMessage(err, "refresh this chapter's figures, so they may be out of date. Reload the page to see them"));
    }
  }, [chapterId]);

  const requested = url.get("view");
  const view: View = requested === "lessons" || requested === "questions" ? requested : "overview";
  const lessonId = url.get("lesson") ?? chapter?.conceptLessons[0]?.id ?? "";
  const hrefFor = useCallback(
    (next: View, lesson?: string) => {
      const params = new URLSearchParams();
      if (next !== "overview") params.set("view", next);
      if (next === "questions" && lesson) params.set("lesson", lesson);
      const q = params.toString();
      return q ? `${pathname}?${q}` : pathname;
    },
    [pathname],
  );

  const r = useMemo(() => (chapter ? reviewOf(chapter.conceptLessons) : null), [chapter]);
  const [listHref, setListHref] = useState("/admin/curriculum");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(LIST_KEY);
      if (saved && saved.startsWith("/admin/curriculum")) setListHref(saved);
    } catch {
      // Storage can be blocked; the plain list is fine.
    }
  }, []);

  if (query.problem && !chapter) return <LoadError problem={query.problem} onRetry={query.reload} />;
  if (!chapter || !r) return <MastheadSkeleton />;

  const tabs: SubTab<View>[] = [
    { key: "overview", label: "Overview", href: hrefFor("overview") },
    { key: "lessons", label: "Lessons", href: hrefFor("lessons"), count: chapter.conceptLessons.length },
    {
      key: "questions",
      label: "Questions",
      href: hrefFor("questions", lessonId),
      count: r.questions - r.approved,
      attention: r.questions - r.approved > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <InlineLink href={listHref} direction="back" size="sm">
        All Chapters
      </InlineLink>
      <PageHeader
        surface="masthead"
        eyebrow={`${chapter.code} · Chapter ${chapter.chapterNo}`}
        title={chapter.title}
        description={
          <Badge tone={CHAPTER_STATUS_TONE[chapter.status]} dot onDark>
            {STATUS_LABEL[chapter.status]}
          </Badge>
        }
        stats={[
          {
            label: "Lessons",
            value: chapter.conceptLessons.length,
            hint: `${chapter.conceptLessons.filter((l) => l.status === "PUBLISHED").length} published`,
          },
          { label: "Questions", value: r.questions, hint: "In the question bank" },
          {
            label: "Approved",
            value: r.approved,
            hint: r.questions ? `${Math.round((r.approved / r.questions) * 100)}% of the questions` : undefined,
            tone: r.questions && r.approved === r.questions ? "good" : "default",
          },
          {
            label: "Flagged",
            value: r.flagged,
            hint: r.flagged ? "The checks found a problem: read these" : "None found so far",
            tone: r.flagged ? "attention" : "default",
          },
        ]}
      />
      <SubTabs label="Chapter views" tabs={tabs} active={view} />
      {refreshProblem ? <ErrorBanner message={refreshProblem} /> : null}
      {view === "overview" ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <StatusCard chapter={chapter} onChanged={refresh} />
          <div className="space-y-6">
            <BulkApprove
              path={`/curriculum-admin/chapters/${chapter.id}/questions/bulk-approve`}
              scopeLabel="this chapter"
              onDone={refresh}
            />
            <Card>
              <CardHeader className="flex-col items-start gap-1.5">
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-brand-600" aria-hidden />
                  Read Before You Approve
                </CardTitle>
                <CardDescription>
                  A status alone doesn&apos;t say what is about to reach students. Under Questions, each lesson&apos;s questions are shown
                  in full, with the keyed answer marked, and can be narrowed to the flagged ones or those still waiting for a decision.
                </CardDescription>
              </CardHeader>
              <CardBody>
                <InlineLink href={hrefFor("questions", lessonId)}>Read the Questions</InlineLink>
              </CardBody>
            </Card>
          </div>
        </div>
      ) : view === "lessons" ? (
        <LessonsView chapter={chapter} onChanged={refresh} questionsHref={(id) => hrefFor("questions", id)} />
      ) : (
        <QuestionsView chapter={chapter} lessonId={lessonId} lessonHref={(id) => hrefFor("questions", id)} onChanged={refresh} />
      )}
    </div>
  );
}
