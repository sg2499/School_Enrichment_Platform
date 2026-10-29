"use client";

/**
 * Curriculum Studio's Chapters tab, for the Super Admin (#212, 29 Oct 2026):
 * every chapter in one table, with how far its questions are through
 * review, searchable and filtered by board, class, subject and status.
 * Each chapter opens on its own page (/admin/curriculum/chapters/<id>),
 * which replaced the full-screen pop-up that had to hold 500 questions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Send } from "lucide-react";
import { BlueprintIllustration } from "@/components/brand/Graphics";
import {
  CHAPTER_STATUS_TONE,
  ErrorBanner,
  LIST_KEY,
  STATUS_LABEL,
  countOf,
  useCurriculumFilterLookups,
} from "@/components/curriculum/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/Field";
import { FilterChips } from "@/components/ui/FilterChips";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SearchInput } from "@/components/ui/SearchInput";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { api, errorMessage } from "@/lib/api";
import { useUrlState } from "@/lib/hooks/useUrlState";
import type { ChapterStatus, ChapterSummary } from "@/types/curriculum";

type StatusFilter = ChapterStatus | "ALL";

export function ChapterLibrary({ onChanged }: { onChanged: () => void }) {
  const router = useRouter();
  const { boards, disciplines, classLevelsForBoard, error: lookupError } = useCurriculumFilterLookups();
  const url = useUrlState();
  const boardId = url.get("board") ?? "";
  const classLevelId = url.get("class") ?? "";
  const disciplineId = url.get("subject") ?? "";
  const asked = url.get("status");
  const status: StatusFilter = asked === "DRAFT" || asked === "REVIEW" || asked === "PUBLISHED" || asked === "ARCHIVED" ? asked : "ALL";
  const query = url.get("q") ?? "";
  const setBoardId = (v: string) => url.set({ board: v, class: null });
  const setClassLevelId = (v: string) => url.set({ class: v });
  const setDisciplineId = (v: string) => url.set({ subject: v });
  const setStatus = (v: StatusFilter) => url.set({ status: v === "ALL" ? null : v });
  const setQuery = (v: string) => url.set({ q: v });
  const listQuery = url.searchParams.toString();
  useEffect(() => {
    try {
      sessionStorage.setItem(LIST_KEY, listQuery ? `/admin/curriculum?${listQuery}` : "/admin/curriculum");
    } catch {
      // Storage can be blocked; "All Chapters" then opens the plain list.
    }
  }, [listQuery]);
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const classes = useMemo(() => classLevelsForBoard(boardId), [classLevelsForBoard, boardId]);
  const scoped = Boolean(boardId || classLevelId || disciplineId);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setProblem(null);
    setLoading(true);
    try {
      const { data } = await api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters", {
        params: { board_id: boardId || undefined, class_level_id: classLevelId || undefined, discipline_id: disciplineId || undefined },
      });
      if (ticket === latest.current) setChapters(data.chapters);
    } catch (err) {
      if (ticket === latest.current) {
        setChapters(null);
        setProblem(errorMessage(err, "load the chapters"));
      }
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [boardId, classLevelId, disciplineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: 0, DRAFT: 0, REVIEW: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const ch of chapters ?? []) {
      c.ALL += 1;
      c[ch.status] += 1;
    }
    return c;
  }, [chapters]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (chapters ?? []).filter(
    (ch) =>
      (status === "ALL" || ch.status === status) &&
      words.every((w) => `${ch.title} ${ch.code} chapter ${ch.chapterNo}`.toLowerCase().includes(w)),
  );
  const drafts = (chapters ?? []).filter((ch) => ch.status === "DRAFT");

  async function sendDrafts() {
    setSending(true);
    setSent(null);
    setProblem(null);
    try {
      const { data } = await api.post<{ updatedChapters: string[] }>("/curriculum-admin/chapters/bulk-status", {
        status: "REVIEW",
        chapterIds: drafts.map((c) => c.id),
      });
      setSent(
        data.updatedChapters.length === 0
          ? "No chapter was moved: only Draft chapters go to review."
          : `${countOf(data.updatedChapters.length, "chapter")} moved to review.`,
      );
      setAsking(false);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorMessage(err, "send these drafts to review"));
      setAsking(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField label="Board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">All Boards</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Class" value={classLevelId} onChange={(e) => setClassLevelId(e.target.value)}>
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField label="Subject" value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)}>
            <option value="">All Subjects</option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={(["ALL", "DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"] as StatusFilter[]).map((s) => ({
              value: s,
              label: s === "ALL" ? "All" : STATUS_LABEL[s],
              count: chapters ? counts[s] : null,
            }))}
          />
          <SearchInput
            value={query}
            onSearch={setQuery}
            label="Search chapters"
            placeholder="Chapter name or code"
            delayMs={150}
            className="w-full sm:ml-auto sm:w-64"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leadingIcon={<Send className="h-4 w-4" />}
            disabled={!chapters || loading || drafts.length === 0}
            onClick={() => {
              setSent(null);
              setAsking(true);
            }}
          >
            {drafts.length === 0 ? "No Drafts to Send" : `Send ${scoped ? "Listed" : "All"} Drafts to Review (${drafts.length})`}
          </Button>
        </div>

        {lookupError ? <ErrorBanner message={lookupError} /> : null}
        {problem ? <ErrorBanner message={problem} /> : null}
        {sent ? (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-jade-50 px-3 py-2 text-xs font-medium text-jade-800">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {sent}
          </p>
        ) : null}

        {chapters === null && !problem ? (
          <TableSkeleton label="Loading chapters" rows={6} />
        ) : chapters && chapters.length === 0 ? (
          <EmptyState
            illustration={scoped ? undefined : <BlueprintIllustration />}
            status={{ label: scoped ? "No Matches" : "Nothing Imported Yet", tone: "neutral" }}
            title={scoped ? "No chapters match these filters" : "No chapters yet"}
            description={
              scoped
                ? "Try a wider board, class or subject."
                : "Chapters are imported outside Curriculum Studio. Each one arrives here as a Draft, ready for review."
            }
          />
        ) : chapters ? (
          shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-content-subtle">
              No chapter matches that.
            </p>
          ) : (
            <Table caption="Chapters" minWidth="54rem">
              <THead>
                <TH className="w-12">No.</TH>
                <TH>Chapter</TH>
                <TH align="right">Lessons Published</TH>
                <TH align="right">Questions</TH>
                <TH className="w-56">Questions Approved</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Open</span>
                </TH>
              </THead>
              <TBody>
                {shown.map((ch) => {
                  const approved = ch.approvedQuestionCount ?? 0;
                  const flagged = ch.flaggedQuestionCount ?? 0;
                  const href = `/admin/curriculum/chapters/${ch.id}`;
                  return (
                    <TR key={ch.id} onClick={() => router.push(href)}>
                      <TD>
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100 tabular">
                          {ch.chapterNo}
                        </span>
                      </TD>
                      <TD>
                        <Link
                          href={href}
                          className="font-semibold text-content underline-offset-2 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {ch.title}
                        </Link>
                        <span className="block text-xs text-content-subtle">{ch.code}</span>
                      </TD>
                      <TD align="right" className="tabular">
                        {ch.publishedLessonCount ?? 0} of {ch.conceptLessonCount}
                      </TD>
                      <TD align="right" className="tabular">
                        {ch.questionCount.toLocaleString("en-IN")}
                      </TD>
                      <TD>
                        <div className="space-y-1.5">
                          <ProgressBar
                            total={ch.questionCount}
                            segments={[{ value: approved, label: "approved", className: "bg-jade-500" }]}
                          />
                          <p className="flex items-center gap-2 text-xs text-content-subtle tabular">
                            {approved.toLocaleString("en-IN")} of {ch.questionCount.toLocaleString("en-IN")}
                            {flagged ? (
                              <Badge tone="danger" size="sm">
                                {flagged} flagged
                              </Badge>
                            ) : null}
                          </p>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={CHAPTER_STATUS_TONE[ch.status]} size="sm">
                          {STATUS_LABEL[ch.status]}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <ChevronRight className="h-4 w-4 text-content-faint" aria-hidden />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )
        ) : null}
      </CardBody>

      <Modal
        open={asking}
        onClose={() => (sending ? undefined : setAsking(false))}
        size="sm"
        title={`Send ${countOf(drafts.length, "Draft Chapter", "Draft Chapters")} to Review?`}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={sending} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button type="button" loading={sending} loadingLabel="Sending" onClick={() => void sendDrafts()}>
              Send to Review
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">
          {scoped ? "Only the Draft chapters matching the board, class and subject chosen. " : ""}Review isn&apos;t visible to any school;
          only Published is.
        </p>
      </Modal>
    </Card>
  );
}
