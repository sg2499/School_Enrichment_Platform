"use client";

import { BookOpen, CalendarCheck, FileSpreadsheet, MessageCircleQuestion, Target, TrendingUp } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { greetingForHour } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ModuleCard, DetailRow } from "@/components/ui/ModuleCard";
import { AuroraBackdropInverse, PathIllustration } from "@/components/brand/Graphics";

const MODULES = [
  {
    icon: <BookOpen className="h-5 w-5" aria-hidden />,
    title: "Chapter lessons",
    description: "Read, watch and work through a chapter at your own pace, in the order your teacher sets.",
    tone: "brand" as const,
  },
  {
    icon: <Target className="h-5 w-5" aria-hidden />,
    title: "Daily practice",
    description: "A short set of questions each day, built from the chapter you are on right now.",
    tone: "accent" as const,
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" aria-hidden />,
    title: "Mock papers",
    description: "Full-length practice papers in your board's format, so exam day feels familiar.",
    tone: "jade" as const,
  },
  {
    icon: <TrendingUp className="h-5 w-5" aria-hidden />,
    title: "My progress",
    description: "See which topics you have mastered and which ones deserve another go.",
    tone: "brand" as const,
  },
];

const LOOP = [
  { day: "Learn", body: "Meet the chapter with worked examples." },
  { day: "Practise", body: "Try it yourself, with hints when you get stuck." },
  { day: "Check", body: "Short quiz to see what stuck." },
  { day: "Fix", body: "Go again on just the bits that wobbled." },
  { day: "Master", body: "Prove it, and move on with confidence." },
];

export default function StudentDashboardPage() {
  const { user, status } = useProtectedPage("STUDENT");

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? "there";
  const greeting = greetingForHour(new Date().getHours());
  const student = user?.student ?? null;
  const classLabel = student?.className
    ? `Class ${student.className}${student.section ? ` ${student.section}` : ""}`
    : null;

  return (
    <RoleShell role="STUDENT" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow={greeting}
          title={
            <>
              Hello, <span className="text-gradient-brand">{firstName}</span>
            </>
          }
          description="This is your learning space. As soon as your school loads its curriculum, your lessons and daily practice will show up right here."
          meta={
            <>
              {classLabel ? <Badge tone="brand">{classLabel}</Badge> : null}
              {student?.studentCode ? <Badge tone="neutral">ID {student.studentCode}</Badge> : null}
              <Badge tone="accent" dot pulse>
                Getting set up
              </Badge>
            </>
          }
        />

        {/* Hero empty state */}
        <Card tone="inverse" className="animate-fade-up">
          <AuroraBackdropInverse />
          <CardBody className="relative z-10 sm:p-9">
            <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-4">
                <Badge tone="inverse" dot pulse>
                  Nothing to do yet
                </Badge>
                <h2 className="font-display text-display-md text-balance text-content-inverse">
                  Your first chapter is on its way.
                </h2>
                <p className="max-w-prose text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">
                  Your teachers are loading this year&apos;s syllabus into School Enrichment. When they publish your
                  first chapter, it will appear here with everything you need &mdash; the lesson, the practice and a
                  clear way to see how you are doing.
                </p>
                <ul className="grid gap-2 pt-1 sm:grid-cols-2">
                  {["No app to install", "Works on a shared phone or tablet", "Your teacher sets the pace", "Nothing is graded until you are ready"].map(
                    (point) => (
                      <li key={point} className="flex items-start gap-2.5 text-[0.8125rem] text-white/70">
                        <span aria-hidden className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-300" />
                        {point}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div className="glass-panel rounded-3xl p-5">
                <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-200">
                  How a chapter works
                </p>
                <ol className="mt-4 space-y-3">
                  {LOOP.map((step, index) => (
                    <li key={step.day} className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/12 text-[0.6875rem] font-bold text-saffron-200 ring-1 ring-inset ring-white/15">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.8125rem] font-semibold text-content-inverse">{step.day}</span>
                        <span className="block text-[0.75rem] leading-relaxed text-white/60">{step.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* What's coming */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-display-sm text-content">What you&apos;ll find here</h2>
            <Badge tone="neutral">Coming soon</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {MODULES.map((module, index) => (
              <ModuleCard
                key={module.title}
                icon={module.icon}
                title={module.title}
                description={module.description}
                tone={module.tone}
                status={{ label: "Soon", tone: "neutral" }}
                className={`animate-fade-up ${["delay-70", "delay-140", "delay-210", "delay-280"][index] ?? ""}`}
              />
            ))}
          </div>
        </section>

        {/* Meanwhile + profile */}
        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <Card className="animate-fade-up">
            <CardBody>
              <EmptyState
                illustration={<PathIllustration />}
                status={{ label: "Waiting on your school", tone: "accent" }}
                title="Nothing to practise today"
                description="When your first chapter is published you'll see a short daily set here — usually ten to fifteen minutes' work, never a wall of homework."
                points={[
                  "Your streak and progress start counting from your first practice",
                  "Anything you get wrong comes back later, not never",
                ]}
              />
            </CardBody>
          </Card>

          <Card className="animate-fade-up delay-70">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <CalendarCheck className="h-5 w-5" aria-hidden />
                </CardIcon>
                <CardTitle>Your details</CardTitle>
              </div>
              <dl className="-mt-1">
                <DetailRow label="Name" value={user?.fullName ?? "—"} />
                <DetailRow label="Class" value={classLabel ?? "Not assigned yet"} />
                <DetailRow label="Student ID" value={student?.studentCode ?? "—"} />
              </dl>
              <p className="flex items-start gap-2.5 rounded-2xl bg-surface-brand p-3.5 text-[0.8125rem] leading-relaxed text-content-muted">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                Something here looks wrong? Tell your class teacher &mdash; they can correct it for you.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </RoleShell>
  );
}
