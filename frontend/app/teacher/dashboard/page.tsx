"use client";

import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Compass,
  IdCard,
  Layers,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { DetailRow, ModuleCard } from "@/components/ui/ModuleCard";
import { RosterIllustration } from "@/components/brand/Graphics";

const MODULES = [
  {
    icon: <Users className="h-5 w-5" aria-hidden />,
    title: "My classes",
    description: "Every section you teach, with each student's current chapter and where they are stuck.",
    tone: "brand" as const,
  },
  {
    icon: <ClipboardList className="h-5 w-5" aria-hidden />,
    title: "Assignments",
    description: "Set a chapter, a practice set or a mock paper for a whole section in a couple of clicks.",
    tone: "accent" as const,
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" aria-hidden />,
    title: "Marking",
    description: "School-style marking with part marks, so scores here mean the same thing they do on paper.",
    tone: "jade" as const,
  },
  {
    icon: <BarChart3 className="h-5 w-5" aria-hidden />,
    title: "Class analytics",
    description: "Chapter-level mastery across a section, so reteaching targets the right two topics.",
    tone: "brand" as const,
  },
];

const READINESS = [
  { label: "Your account and secure sign-in", state: "Ready", tone: "success" as const },
  { label: "School curriculum imported", state: "In progress", tone: "warning" as const },
  { label: "Question bank reviewed and published", state: "In progress", tone: "warning" as const },
  { label: "Class rosters linked to you", state: "Not started", tone: "neutral" as const },
  { label: "Assignments and marking", state: "Planned", tone: "neutral" as const },
];

export default function TeacherDashboardPage() {
  const { user, status } = useProtectedPage("TEACHER");

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const teacher = user?.teacher ?? null;
  const surname = user?.fullName?.trim().split(/\s+/).slice(-1)[0] ?? "";

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Teaching workspace"
          title={
            <>
              Welcome, <span className="text-gradient-brand">{user?.fullName ?? surname}</span>
            </>
          }
          description="Your classes, assignments and marking queue will live here. Right now the workspace is waiting on the school's curriculum import."
          meta={
            <>
              {teacher?.designation ? <Badge tone="brand">{teacher.designation}</Badge> : null}
              {teacher?.subjectSpecialization ? (
                <Badge tone="neutral">{teacher.subjectSpecialization}</Badge>
              ) : null}
              <Badge tone="accent" dot pulse>
                Setup in progress
              </Badge>
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <Card className="animate-fade-up">
            <CardBody className="sm:p-8">
              <EmptyState
                illustration={<RosterIllustration />}
                status={{ label: "No classes linked yet", tone: "brand" }}
                title="Your classes will appear here"
                description="Once your school admin publishes the curriculum and links you to your sections, each class lands on this screen with its roster, current chapter and outstanding work."
                points={[
                  "One card per section, ordered by what needs you first",
                  "Student-level detail without leaving the class view",
                  "Nothing is shared with students until you assign it",
                ]}
              />
            </CardBody>
          </Card>

          {/* Readiness checklist -- honest status, no invented numbers. */}
          <Card className="animate-fade-up delay-70">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="accent">
                  <Layers className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Rollout status</CardTitle>
                  <p className="mt-0.5 text-xs text-content-subtle">What is live for your school</p>
                </div>
              </div>
              <ul className="space-y-3">
                {READINESS.map((item) => (
                  <li key={item.label} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[0.8125rem] leading-relaxed text-content-muted">{item.label}</span>
                    <Badge tone={item.tone} className="shrink-0">
                      {item.state}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-display-sm text-content">Your toolkit</h2>
              <p className="mt-1 text-sm text-content-muted">
                Built for the way Indian schools actually teach &mdash; chapter by chapter, section by section.
              </p>
            </div>
            <Badge tone="neutral">Rolling out</Badge>
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

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="animate-fade-up">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <IdCard className="h-5 w-5" aria-hidden />
                </CardIcon>
                <CardTitle>Your profile</CardTitle>
              </div>
              <dl className="-mt-1">
                <DetailRow label="Name" value={user?.fullName ?? "—"} />
                <DetailRow label="Teacher code" value={teacher?.teacherCode ?? "—"} />
                <DetailRow label="Designation" value={teacher?.designation ?? "Not set"} />
                <DetailRow label="Subject" value={teacher?.subjectSpecialization ?? "Not set"} />
              </dl>
            </CardBody>
          </Card>

          <Card tone="brand" className="animate-fade-up delay-70">
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <Compass className="h-5 w-5" aria-hidden />
                </CardIcon>
                <CardTitle>While you wait</CardTitle>
              </div>
              <p className="text-[0.875rem] leading-relaxed text-content-muted">
                Nothing is required from you yet. When your sections are linked you will get them pre-populated
                &mdash; no manual roster entry, no spreadsheet uploads on your side.
              </p>
              <p className="text-[0.875rem] leading-relaxed text-content-muted">
                If a chapter list or a student record looks wrong once it appears, flag it to your school admin from
                the class view rather than editing around it.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </RoleShell>
  );
}
