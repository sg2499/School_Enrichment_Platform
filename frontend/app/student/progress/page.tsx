"use client";

/**
 * My Progress, for a student (#184, 26 Oct 2026): how they are doing on
 * every skill of their chapters, what to practise next, and the practice
 * they started themselves. A weak skill's Extra Practice or Remediation set
 * can be opened from here; it never counts towards term marks.
 */
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, PlayCircle, Sparkles, Trophy } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import {
  BAND_LABEL,
  BAND_TONE,
  bandMeaning,
  chaptersWithStanding,
  STANDING_LABEL,
  standingText,
  percentText,
  selfPracticeAction,
  selfPracticeHref,
  selfPracticeStatus,
} from "@/lib/progress";
import { formatDay } from "@/lib/tracker";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import { MockPaperResults } from "@/components/progress/MockPaperResults";
import { SkillMap } from "@/components/progress/SkillMap";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { PractiseNextItem, ProgressPayload } from "@/types/progress";

function PractiseNextCard({
  item,
  minAnswers,
  busyId,
  onSelfPractice,
}: {
  item: PractiseNextItem;
  minAnswers: number;
  busyId: string | null;
  onSelfPractice: (activityId: string, openTargetId: string | null) => void;
}) {
  const { skill } = item;
  const nothing = item.assigned.length === 0 && item.selfPractice.length === 0;
  return (
    <Card as="li">
      <CardBody className="space-y-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-content-subtle">{skill.chapterTitle}</p>
            <h3 className="font-display text-base font-semibold text-content">{skill.title}</h3>
            <p className="mt-1 text-sm text-content-muted">
              {percentText(skill.percent)} right · {bandMeaning(skill.band, minAnswers)}
            </p>
          </div>
          <Badge tone={BAND_TONE[skill.band]}>{BAND_LABEL[skill.band]}</Badge>
        </div>
        {nothing ? (
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-content-muted">
            There&apos;s no practice set for this skill yet. Ask your teacher for some practice on it.
          </p>
        ) : (
          <ul className="space-y-2">
            {item.assigned.map((set) => (
              <li
                key={set.assignmentTargetId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-content">{set.title}</span>
                  <span className="block text-xs text-content-subtle">
                    From your teacher{set.dueDate ? ` · Due ${formatDay(set.dueDate)}` : ""}
                  </span>
                </span>
                <ButtonLink
                  href={`/student/practice/${set.assignmentTargetId}`}
                  size="sm"
                  variant="secondary"
                  leadingIcon={<ClipboardList className="h-3.5 w-3.5" />}
                >
                  {set.status === "IN_PROGRESS" ? "Continue" : "Start"}
                </ButtonLink>
              </li>
            ))}
            {item.selfPractice.map((set) => (
              <li
                key={set.learningActivityId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-content">{set.title}</span>
                  <span className="block text-xs text-content-subtle">
                    {[
                      ACTIVITY_TYPE_LABEL[set.activityType],
                      set.questionCount ? `${set.questionCount} questions` : null,
                      set.estimatedMinutes ? `About ${set.estimatedMinutes} min` : null,
                      "Doesn't count towards your marks",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="tinted"
                  leadingIcon={<PlayCircle className="h-3.5 w-3.5" />}
                  loading={busyId === set.learningActivityId}
                  loadingLabel="Opening"
                  disabled={Boolean(busyId) && busyId !== set.learningActivityId}
                  onClick={() => onSelfPractice(set.learningActivityId, set.openTargetId)}
                >
                  {selfPracticeAction(set.openTargetId, set.openTargetStatus)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * #185: the student's place in their class, said only as Top 10%, Top 25%
 * or Top Half, overall and per chapter. Shown only when there is one to
 * show; a student in the lower half, or in a class too small to compare,
 * simply doesn't see this section.
 */
function WhereYouStand({ data }: { data: ProgressPayload }) {
  const standing = data.standing;
  const chapters = chaptersWithStanding(data.chapters);
  if (!standing || (!standing.overall && chapters.length === 0)) return null;
  const where = standing.classLabel ? `${standing.classLabel} at your school` : "your class at your school";
  return (
    <section aria-labelledby="stand-heading" className="space-y-4">
      <div>
        <h2 id="stand-heading" className="font-display text-display-sm text-content">
          Where You Stand
        </h2>
        <p className="mt-1 text-sm text-content-muted">
          Compared with everyone in {where} who has practised the same chapters. Practice you do on your own isn&apos;t counted here.
        </p>
      </div>
      <Card>
        <CardBody className="space-y-4 sm:p-6">
          {standing.overall ? (
            <p className="flex flex-wrap items-center gap-3">
              <Trophy className="h-5 w-5 text-saffron-600" aria-hidden="true" />
              <span className="font-display text-lg font-semibold text-content">
                {standingText(standing.overall, standing.classLabel)}
              </span>
              <span className="text-sm text-content-muted">across all your chapters</span>
            </p>
          ) : null}
          {chapters.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Your chapter standings">
              {chapters.map((chapter) => (
                <li key={chapter.id} className="rounded-2xl border border-line px-3 py-2 text-sm">
                  <span className="font-semibold text-content">{chapter.title}</span>
                  <span className="text-content-muted"> · {STANDING_LABEL[chapter.standing]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

function MyProgressPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const router = useRouter();
  const ready = status === "ready" && Boolean(user);
  const query = useApiQuery<ProgressPayload>(ready ? "/learning/my-progress" : null, {}, { action: "load your progress" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function selfPractice(activityId: string, openTargetId: string | null) {
    setProblem(null);
    if (openTargetId) {
      router.push(`/student/practice/${openTargetId}`);
      return;
    }
    setBusyId(activityId);
    try {
      const { data } = await api.post<{ assignmentTargetId: string }>("/learning/self-practice", { learningActivityId: activityId });
      router.push(`/student/practice/${data.assignmentTargetId}`);
    } catch (err) {
      setProblem(errorMessage(err, "open this practice"));
      setBusyId(null);
      query.reload();
    }
  }

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  const data = query.problem ? null : query.data;
  const summary = data?.summary;
  const practised = summary ? summary.skills - summary.notStarted : 0;

  return (
    <RoleShell role="STUDENT" user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Track"
          title="My Progress"
          description="How you're doing on every skill, from the practice you've handed in and your mock papers. Your latest answer to each question counts."
          stats={[
            {
              label: "Strong",
              value: query.problem ? "—" : summary ? summary.strong : null,
              tone: summary && summary.strong > 0 ? "good" : "default",
            },
            { label: "Getting There", value: query.problem ? "—" : summary ? summary.gettingThere : null },
            {
              label: "Needs Work",
              value: query.problem ? "—" : summary ? summary.needsWork : null,
              tone: summary && summary.needsWork > 0 ? "attention" : "default",
            },
            {
              label: "Overall",
              value: query.problem ? "—" : summary ? percentText(summary.overallPercent) : null,
              hint: summary ? `${practised} of ${summary.skills} skills practised` : undefined,
            },
          ]}
        />

        {query.problem ? <LoadError problem={query.problem} onRetry={query.reload} /> : null}
        {problem ? <AlertBanner tone="error" message={problem} /> : null}

        {!data && !query.problem ? (
          <TableSkeleton label="Loading your progress" rows={4} />
        ) : data ? (
          <>
            <section aria-labelledby="next-heading" className="space-y-4">
              <h2 id="next-heading" className="font-display text-display-sm text-content">
                Practise Next
              </h2>
              {data.practiseNext.length === 0 ? (
                <Card>
                  <CardBody className="sm:p-7">
                    <EmptyState
                      illustration={<Sparkles className="h-6 w-6" aria-hidden="true" />}
                      title={practised > 0 ? "Nothing to Fix Right Now" : "Nothing Here Yet"}
                      description={
                        practised > 0
                          ? "None of your skills needs work at the moment. Keep going with the practice your teacher sets."
                          : "Hand in a practice set and your skills appear here, with what to practise next."
                      }
                    />
                  </CardBody>
                </Card>
              ) : (
                <ol className="space-y-3">
                  {data.practiseNext.map((item) => (
                    <PractiseNextCard
                      key={item.skill.id}
                      item={item}
                      minAnswers={data.thresholds.minAnswers}
                      busyId={busyId}
                      onSelfPractice={selfPractice}
                    />
                  ))}
                </ol>
              )}
            </section>

            <MockPaperResults
              papers={data.mockPapers ?? []}
              description="Mock papers your teacher set, from when you hand them in. Your answers count in your skills below; they don't count towards your term marks."
              hrefFor={(id) => `/student/papers/${id}`}
            />

            <WhereYouStand data={data} />

            {data.selfPractice && data.selfPractice.length > 0 ? (
              <section aria-labelledby="own-heading" className="space-y-4">
                <div>
                  <h2 id="own-heading" className="font-display text-display-sm text-content">
                    Your Own Practice
                  </h2>
                  <p className="mt-1 text-sm text-content-muted">Sets you opened yourself. They don&apos;t count towards your marks.</p>
                </div>
                <Card>
                  <ul className="divide-y divide-line">
                    {data.selfPractice.map((item) => {
                      const action = selfPracticeHref(item);
                      return (
                        <li key={item.assignmentTargetId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-content">{item.title ?? "Practice"}</span>
                            <span className="block text-xs text-content-subtle">
                              {[
                                item.startedAt ? `Started ${formatDay(item.startedAt)}` : null,
                                `${item.attemptsMade} of ${item.maxAttempts} attempts`,
                                selfPracticeStatus(item),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <ButtonLink href={action.href} size="sm" variant="tinted">
                            {action.label}
                          </ButtonLink>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </section>
            ) : null}

            <section aria-labelledby="skills-heading" className="space-y-4">
              <div>
                <h2 id="skills-heading" className="font-display text-display-sm text-content">
                  All Skills
                </h2>
                <p className="mt-1 text-sm text-content-muted">
                  Strong is {data.thresholds.strong}% or more, Getting There {data.thresholds.gettingThere}% to{" "}
                  {data.thresholds.strong - 1}%, Needs Work below {data.thresholds.gettingThere}%. A skill shows a band once you&apos;ve
                  answered {data.thresholds.minAnswers} of its questions.
                </p>
              </div>
              <SkillMap
                chapters={data.chapters}
                summary={data.summary}
                emptyText="Your skills appear here once your school sets up your chapters."
                classLabel={data.standing?.classLabel}
              />
            </section>
          </>
        ) : null}
      </div>
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MyProgressPage />
    </Suspense>
  );
}
