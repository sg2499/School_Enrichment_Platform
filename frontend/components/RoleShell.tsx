"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Database,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Library,
  LifeBuoy,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { clearSession } from "@/lib/auth";
import type { CurrentUser, UserRole } from "@/types/auth";
import { cn, initialsFromName } from "@/lib/utils";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  SUPER_ADMIN: "Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

const ROLE_TAGLINE: Record<UserRole, string> = {
  ADMIN: "School control centre",
  SUPER_ADMIN: "School control centre",
  TEACHER: "Teaching workspace",
  STUDENT: "Your learning space",
};

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Only the item that is actually built gets an href. */
  href?: string;
  /** Everything else is shown as a legible, honest "not built yet" row --
   *  it sets expectations without pretending to be a working link. */
  soon?: boolean;
};

// Structural reuse of the three-role shell pattern (Phase 0 audit,
// "Refactor" bucket): role-scoped navigation and a persistent identity
// header. The visual language, layout, and copy are original to School
// Enrichment. Items without an href are deliberately inert -- routes for
// them land with their phases (Curriculum Studio in Phase 2, the learning
// loop in Phase 3, marking in Phase 4, reports in Phase 6).
const NAV: Record<UserRole, { section: string; items: NavItem[] }[]> = {
  STUDENT: [
    {
      section: "Learn",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/student/dashboard" },
        { label: "My lessons", icon: BookOpen, soon: true },
        { label: "Daily practice", icon: Target, soon: true },
        { label: "Mock papers", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Track",
      items: [
        { label: "My progress", icon: TrendingUp, soon: true },
        { label: "Report card", icon: BarChart3, soon: true },
      ],
    },
  ],
  TEACHER: [
    {
      section: "Teaching",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/teacher/dashboard" },
        { label: "My classes", icon: Users, soon: true },
        { label: "Assignments", icon: ClipboardList, soon: true },
        { label: "Marking", icon: ClipboardCheck, soon: true },
      ],
    },
    {
      section: "Insight",
      items: [
        { label: "Class analytics", icon: BarChart3, soon: true },
        { label: "Curriculum map", icon: Compass, soon: true },
      ],
    },
  ],
  ADMIN: [
    {
      section: "School",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
        { label: "People", icon: Users, soon: true },
        { label: "Classes & sections", icon: GraduationCap, soon: true },
      ],
    },
    {
      section: "Content",
      items: [
        { label: "Curriculum studio", icon: Library, soon: true },
        { label: "Question bank", icon: Database, soon: true },
        { label: "Papers & mocks", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Operations",
      items: [
        { label: "Reports", icon: BarChart3, soon: true },
        { label: "Settings", icon: Settings, soon: true },
      ],
    },
  ],
  SUPER_ADMIN: [
    {
      section: "School",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
        { label: "People", icon: Users, soon: true },
        { label: "Classes & sections", icon: GraduationCap, soon: true },
      ],
    },
    {
      section: "Content",
      items: [
        { label: "Curriculum studio", icon: Library, soon: true },
        { label: "Question bank", icon: Database, soon: true },
        { label: "Papers & mocks", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Operations",
      items: [
        { label: "Reports", icon: BarChart3, soon: true },
        { label: "Settings", icon: Settings, soon: true },
      ],
    },
  ],
};

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base =
    "group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition duration-200 ease-spring";

  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          base,
          active
            ? "bg-white/12 text-content-inverse shadow-hairline ring-1 ring-inset ring-white/15"
            : "text-white/70 hover:bg-white/[0.08] hover:text-content-inverse",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl",
            active
              ? "bg-accent-gradient text-brand-950 shadow-accent"
              : "bg-white/[0.08] ring-1 ring-inset ring-white/10",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <span
      aria-disabled="true"
      title={`${item.label} arrives in a later phase`}
      className={cn(base, "cursor-default text-white/55 hover:bg-white/[0.06] hover:text-white/75")}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/10">
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate">{item.label}</span>
      <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-eyebrow text-white/60">
        Soon
      </span>
    </span>
  );
}

function SidebarContent({
  role,
  user,
  pathname,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  role: UserRole;
  user: CurrentUser | null;
  pathname: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-brand-gradient">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute bottom-10 right-[-4rem] h-56 w-56 rounded-full bg-saffron-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-grid-inverse opacity-60" />
      </div>

      <div className="relative flex items-center gap-3 px-5 pb-6 pt-6">
        <Lockup tone="light" showTagline />
      </div>

      <div className="relative px-5">
        <div className="glass-panel flex items-center gap-3 rounded-2xl px-3.5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-[0.8125rem] font-bold text-white ring-1 ring-inset ring-white/20">
            {initialsFromName(user?.fullName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content-inverse">
              {user?.fullName ?? "Signed in"}
            </span>
            <span className="block truncate text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-saffron-300">
              {ROLE_LABEL[role]}
            </span>
          </span>
        </div>
      </div>

      <nav className="relative mt-6 flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {NAV[role].map((group) => (
          <div key={group.section} className="space-y-1">
            <p className="px-3 pb-1 text-[0.625rem] font-bold uppercase tracking-eyebrow text-white/40">
              {group.section}
            </p>
            {group.items.map((item) => (
              <NavRow
                key={item.label}
                item={item}
                active={!!item.href && item.href === pathname}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="relative space-y-3 border-t border-white/10 px-5 py-5">
        <p className="flex items-center gap-2 text-xs text-white/55">
          <LifeBuoy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Need help? Ask your school coordinator.
        </p>
        <Button
          variant="quiet"
          size="sm"
          fullWidth
          onClick={onSignOut}
          loading={signingOut}
          loadingLabel="Signing out"
          leadingIcon={<LogOut className="h-4 w-4" />}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

/**
 * Persistent chrome for every signed-in view. A fixed indigo rail on large
 * screens (identity, role, navigation, sign-out) with a compact sticky bar
 * and slide-in drawer below `lg` -- schools are heavily phone- and
 * low-end-tablet-based, so the small-screen path is a first-class layout,
 * not a squeeze of the desktop one.
 */
export function RoleShell({
  role,
  user,
  children,
}: {
  role: UserRole;
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await api.post("/auth/logout");
    } finally {
      clearSession();
      router.push("/login");
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-sidebar lg:block">
        <SidebarContent role={role} user={user} pathname={pathname} onSignOut={handleLogout} signingOut={signingOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-9 w-9" />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-sm font-semibold text-content">School Enrichment</span>
            <span className="text-[0.625rem] font-bold uppercase tracking-eyebrow text-content-brand">
              {ROLE_LABEL[role]}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line-strong bg-surface text-content-muted transition hover:border-brand-300 hover:text-content-brand"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-brand-950/55 backdrop-blur-sm animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 w-[min(20rem,86vw)] animate-fade-in shadow-panel">
            <SidebarContent
              role={role}
              user={user}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              onSignOut={handleLogout}
              signingOut={signingOut}
            />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 ring-1 ring-inset ring-white/15 transition hover:bg-white/20"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {/* Content column */}
      <div className="relative lg:pl-sidebar">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-canvas-glow" />

        {/* Desktop context bar */}
        <div className="relative z-10 hidden items-center justify-between gap-4 px-8 pt-7 lg:flex">
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-xs font-medium text-content-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-saffron-500" aria-hidden />
            {ROLE_TAGLINE[role]}
          </span>
          <span className="flex items-center gap-3">
            <Badge tone="brand" dot pulse>
              Session active
            </Badge>
            <span className="flex items-center gap-2.5 rounded-full border border-line bg-surface/80 py-1.5 pl-1.5 pr-4 shadow-xs backdrop-blur">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
                {initialsFromName(user?.fullName)}
              </span>
              <span className="text-sm font-semibold text-content">{user?.fullName ?? "Signed in"}</span>
            </span>
          </span>
        </div>

        <main className="relative z-10 mx-auto w-full max-w-shell px-4 py-8 sm:px-6 lg:px-8 lg:py-10">{children}</main>

        <footer className="relative z-10 mx-auto w-full max-w-shell px-4 pb-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 border-t border-line pt-5 text-xs text-content-faint sm:flex-row sm:items-center sm:justify-between">
            <span>School Enrichment &middot; CBSE &amp; ICSE, Class 5&ndash;10</span>
            <span>Signed in as {ROLE_LABEL[role].toLowerCase()}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
