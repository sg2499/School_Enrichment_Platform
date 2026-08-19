"use client";

import {
  BarChart3,
  Building2,
  CheckCircle2,
  Circle,
  CircleDashed,
  Database,
  FileSpreadsheet,
  GraduationCap,
  Library,
  ShieldCheck,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { DetailRow, ModuleCard } from "@/components/ui/ModuleCard";
import { BlueprintIllustration } from "@/components/brand/Graphics";
import { cn } from "@/lib/utils";

type StageState = "done" | "active" | "planned";

const STAGES: { title: string; body: string; state: StageState }[] = [
  {
    title: "Platform and secure sign-in",
    body: "Role-based access for admins, teachers and students, with server-verified sessions.",
    state: "done",
  },
  {
    title: "Curriculum and question bank",
    body: "Import chapters and questions, review them, then publish to the school.",
    state: "active",
  },
  {
    title: "Daily learning loop",
    body: "Chapter lessons and practice released to students on a five-day cycle.",
    state: "planned",
  },
  {
    title: "School marking engine",
    body: "Part marks and school-style grading so scores match what teachers award on paper.",
    state: "planned",
  },
  {
    title: "Papers, mocks and reports",
    body: "Board-format papers and the analytics your leadership team will ask for.",
    state: "planned",
  },
];

const STAGE_STYLE: Record<StageState, { badge: string; tone: BadgeTone; icon: React.ReactNode; rail: string }> = {
  done: {
    badge: "Live",
    tone: "success",
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
    rail: "bg-jade-500 text-white ring-jade-100",
  },
  active: {
    badge: "In build",
    tone: "warning",
    icon: <CircleDashed className="h-4 w-4" aria-hidden />,
    rail: "bg-saffron-400 text-brand-950 ring-saffron-100",
  },
  planned: {
    badge: "Planned",
    tone: "neutral",
    icon: <Circle className="h-4 w-4" aria-hidden />,
    rail: "bg-ink-200 text-ink-600 ring-ink-100",
  },
};

const MODULES = [
  {
    icon: <Library className="h-5 w-5" aria-hidden />,
    title: "Curriculum studio",
    description: "Draft, review and publish chapters mapped to CBSE or ICSE, class by class.",
    tone: "brand" as const,
    status: { label: "In build", tone: "warning" as const },
  },
  {
    icon: <Database className="h-5 w-5" aria-hidden />,
    title: "Question bank",
    description: "Import from spreadsheets, review quality, and map every question to a chapter.",
    tone: "accent" as const,
    status: { label: "In build", tone: "warning" as const },
  },
  {
    icon: <Users className="h-5 w-5" aria-hidden />,
    title: "People",
    description: "Staff and student accounts, codes, and who can see which section.",
    tone: "jade" as const,
    status: { label: "Soon", tone: "neutral" as const },
  },
  {
    icon: <GraduationCap className="h-5 w-5" aria-hidden />,
    title: "Classes & sections",
    description: "The structure everything else hangs off — classes, sections and teacher links.",
    tone: "brand" as const,
    status: { label: "Soon", tone: "neutral" as const },
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" aria-hidden />,
    title: "Papers & mocks",
    description: "Generate board-format papers from published content, with answer keys.",
    tone: "accent" as const,
    status: { label: "Planned", tone: "neutral" as const },
  },
  {
    icon: <BarChart3 className="h-5 w-5" aria-hidden />,
    title: "Reports",
    description: "Chapter mastery and cohort trends for class teachers and school leadership.",
    tone: "jade" as const,
    status: { label: "Planned", tone: "neutral" as const },
  },
];

export default function AdminDashboardPage() {
  const { user, status } = useProtectedPage("ADMIN");

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const schoolId = user?.admin?.schoolId ?? null;
  // The page itself is shared by both admin variants (useProtectedPage's
  // "ADMIN" argument above just means "either kind of admin may load this
  // page" -- see its own docstring), so the actual role shown in the
  // sidebar has to come from the real signed-in user, not that literal
  // string, or a super admin's tab would always display as a plain admin.
  const roleForShell = user?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="School control centre"
          title={
            <>
              Welcome, <span className="text-gradient-brand">{user?.fullName ?? "Admin"}</span>
            </>
          }
          description="Set up the school, shape the curriculum, and control what teachers and students see. Modules unlock here as each one goes live."
          meta={
            <>
              <Badge tone="success" dot>
                Sign-in live
              </Badge>
              <Badge tone="warning" dot pulse>
                Curriculum in build
              </Badge>
              {user?.role === "SUPER_ADMIN" ? <Badge tone="brand">Platform admin</Badge> : null}
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          {/* Rollout timeline -- reflects real build state, no invented metrics. */}
          <Card className="animate-fade-up">
            <CardBody className="space-y-6">
              <div className="flex items-start gap-3">
                <CardIcon tone="brand">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Rollout</CardTitle>
                  <p className="mt-0.5 text-xs text-content-subtle">Where your school sits in the build</p>
                </div>
              </div>

              <ol className="relative space-y-5 pl-1">
                <span aria-hidden className="absolute bottom-3 left-[0.9375rem] top-3 w-px bg-line" />
                {STAGES.map((stage) => {
                  const style = STAGE_STYLE[stage.state];
                  return (
                    <li key={stage.title} className="relative flex gap-4">
                      <span
                        className={cn(
                          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface",
                          style.rail,
                        )}
                      >
                        {style.icon}
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-content">{stage.title}</span>
                          <Badge tone={style.tone} size="sm">
                            {style.badge}
                          </Badge>
                        </span>
                        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-content-muted">
                          {stage.body}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card className="animate-fade-up delay-70">
              <CardBody className="sm:p-8">
                <EmptyState
                  illustration={<BlueprintIllustration />}
                  status={{ label: "No curriculum published", tone: "warning" }}
                  title="Nothing is live for your school yet"
                  description="Chapters and questions move through draft, review and publish before anyone sees them. Once the first subject is published, this panel becomes your live view of what students and teachers can access."
                  points={[
                    "Publishing is deliberate — students only ever see reviewed content",
                    "Imports run per class and subject, so you can start with one",
                  ]}
                />
              </CardBody>
            </Card>

            <Card tone="brand" className="animate-fade-up delay-140">
              <CardBody className="space-y-4">
                <div className="flex items-center gap-3">
                  <CardIcon tone="brand">
                    <Building2 className="h-5 w-5" aria-hidden />
                  </CardIcon>
                  <CardTitle>Your school</CardTitle>
                </div>
                <dl className="-mt-1">
                  <DetailRow label="Administrator" value={user?.fullName ?? "—"} />
                  <DetailRow label="Access level" value={user?.role === "SUPER_ADMIN" ? "Platform admin" : "School admin"} />
                  <DetailRow
                    label="School ID"
                    value={
                      schoolId ? (
                        <span className="font-mono text-[0.75rem]">{schoolId}</span>
                      ) : (
                        "Platform-wide access"
                      )
                    }
                  />
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-display-sm text-content">Modules</h2>
              <p className="mt-1 text-sm text-content-muted">
                Each module opens here the moment it ships &mdash; nothing to install or configure.
              </p>
            </div>
            <Badge tone="neutral">6 modules</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((module, index) => (
              <ModuleCard
                key={module.title}
                icon={module.icon}
                title={module.title}
                description={module.description}
                tone={module.tone}
                status={module.status}
                className={`animate-fade-up ${
                  ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"][index] ?? ""
                }`}
              />
            ))}
          </div>
        </section>
      </div>
    </RoleShell>
  );
}
