"use client";

import { useEffect, useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { clearSession } from "@/lib/auth";
import type { CurrentUser, UserRole } from "@/types/auth";
import { cn } from "@/lib/utils";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { UserMenu, SidebarUserMenu } from "@/components/UserMenu";

// Title Case throughout -- this is the single source every surface in
// RoleShell reads from (rail title, user card, mobile top bar, footer), so
// fixing a label here fixes it everywhere at once. SUPER_ADMIN used to
// collapse to "Admin" here, which was the real cause of a platform admin's
// tab looking visually identical to a school admin's (18 Aug 2026,
// Shailesh: two tabs signed into different admin variants at once still
// "ended up as either admin or super admin, not both together" -- the
// underlying per-tab session was actually fine, but nothing on screen ever
// showed the difference, so it read as broken).
const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

const ROLE_TAGLINE: Record<UserRole, string> = {
  ADMIN: "School Control Centre",
  SUPER_ADMIN: "Platform Control Centre",
  TEACHER: "Teaching Workspace",
  STUDENT: "Your Learning Space",
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
        { label: "My Lessons", icon: BookOpen, soon: true },
        { label: "Daily Practice", icon: Target, soon: true },
        { label: "Mock Papers", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Track",
      items: [
        { label: "My Progress", icon: TrendingUp, soon: true },
        { label: "Report Card", icon: BarChart3, soon: true },
      ],
    },
  ],
  TEACHER: [
    {
      section: "Teaching",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/teacher/dashboard" },
        { label: "My Classes", icon: Users, soon: true },
        { label: "Assignments", icon: ClipboardList, soon: true },
        { label: "Marking", icon: ClipboardCheck, soon: true },
      ],
    },
    {
      section: "Insight",
      items: [
        { label: "Class Analytics", icon: BarChart3, soon: true },
        { label: "Curriculum Map", icon: Compass, soon: true },
      ],
    },
  ],
  ADMIN: [
    {
      section: "School",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
        { label: "People", icon: Users, href: "/admin/people" },
        { label: "Classes & Sections", icon: GraduationCap, soon: true },
      ],
    },
    {
      section: "Content",
      items: [
        { label: "Curriculum Studio", icon: Library, href: "/admin/curriculum" },
        { label: "Question Bank", icon: Database, soon: true },
        { label: "Papers & Mocks", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Operations",
      items: [
        { label: "Reports", icon: BarChart3, soon: true },
        { label: "Security", icon: ShieldCheck, href: "/admin/security" },
        { label: "Settings", icon: Settings, soon: true },
      ],
    },
  ],
  SUPER_ADMIN: [
    {
      section: "School",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
        { label: "People", icon: Users, href: "/admin/people" },
        { label: "Classes & Sections", icon: GraduationCap, soon: true },
      ],
    },
    {
      section: "Content",
      items: [
        { label: "Curriculum Studio", icon: Library, href: "/admin/curriculum" },
        { label: "Question Bank", icon: Database, soon: true },
        { label: "Papers & Mocks", icon: FileSpreadsheet, soon: true },
      ],
    },
    {
      section: "Operations",
      items: [
        { label: "Reports", icon: BarChart3, soon: true },
        { label: "Security", icon: ShieldCheck, href: "/admin/security" },
        { label: "Settings", icon: Settings, soon: true },
      ],
    },
  ],
};

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base = cn(
    "group flex w-full items-center gap-3 rounded-2xl text-sm font-medium transition duration-200 ease-spring",
    collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
  );

  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          base,
          active
            ? "bg-white/12 text-content-inverse shadow-hairline ring-1 ring-inset ring-white/15"
            : "text-white/70 hover:bg-white/[0.08] hover:text-content-inverse",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            active
              ? "bg-accent-gradient text-brand-950 shadow-accent"
              : "bg-white/[0.08] ring-1 ring-inset ring-white/10",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  return (
    <span
      aria-disabled="true"
      title={collapsed ? `${item.label} — arrives in a later phase` : `${item.label} arrives in a later phase`}
      className={cn(base, "cursor-default text-white/55 hover:bg-white/[0.06] hover:text-white/75")}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/10">
        <Icon className="h-4 w-4" />
      </span>
      {!collapsed ? (
        <>
          <span className="truncate">{item.label}</span>
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-eyebrow text-white/60">
            Soon
          </span>
        </>
      ) : null}
    </span>
  );
}

function SidebarContent({
  role,
  user,
  pathname,
  collapsed = false,
  onNavigate,
  onSignOut,
  signingOut,
  onToggleCollapse,
  onPhotoUpdated,
  hasSecuritySettings,
}: {
  role: UserRole;
  user: CurrentUser | null;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  /** Only the desktop rail can collapse -- the mobile drawer always passes
   *  this as undefined, since it's already a full-width overlay the user
   *  dismisses entirely rather than shrinking. */
  onToggleCollapse?: () => void;
  onPhotoUpdated: (photoUrl: string) => void;
  hasSecuritySettings: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-brand-gradient">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute bottom-10 right-[-4rem] h-56 w-56 rounded-full bg-saffron-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-grid-inverse opacity-60" />
      </div>

      {/* Collapse toggle gets its own row, pinned top-right, ABOVE the logo
          block (19 Aug 2026, Shailesh -- second pass: the previous attempt
          put the toggle on the same row as the logo/tagline text, which
          squeezed the Wordmark's flex width and made "CBSE · ICSE · CLASS
          5-10" wrap onto a second line. The logo block now gets its own
          full-width row with nothing competing for space, so it renders
          exactly as clean as it did before the toggle was ever moved here). */}
      {onToggleCollapse ? (
        <div className={cn("relative flex pt-5", collapsed ? "justify-center px-3" : "justify-end px-5")}>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-white/70 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.16] hover:text-white"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "relative pb-6",
          onToggleCollapse ? "pt-4" : "pt-6",
          collapsed ? "flex justify-center px-3" : "px-5",
        )}
      >
        {collapsed ? <LogoMark className="h-9 w-9" /> : <Lockup tone="light" showTagline />}
      </div>

      <div className={cn("relative", collapsed ? "px-3" : "px-5")}>
        <SidebarUserMenu
          user={user}
          role={role}
          collapsed={collapsed}
          onPhotoUpdated={onPhotoUpdated}
          hasSecuritySettings={hasSecuritySettings}
          onSignOut={onSignOut}
          signingOut={signingOut}
        />
      </div>

      <nav
        className={cn("relative mt-6 flex-1 space-y-6 overflow-y-auto pb-4", collapsed ? "px-3" : "px-3")}
        aria-label="Primary"
      >
        {NAV[role].map((group) => (
          <div key={group.section} className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[0.625rem] font-bold uppercase tracking-eyebrow text-white/40">
                {group.section}
              </p>
            ) : null}
            {group.items.map((item) => (
              <NavRow
                key={item.label}
                item={item}
                active={!!item.href && item.href === pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className={cn("relative space-y-3 border-t border-white/10 py-5", collapsed ? "px-3" : "px-5")}>
        {!collapsed ? (
          <p className="flex items-center gap-2 text-xs text-white/55">
            <LifeBuoy className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Need help? Ask your school coordinator.
          </p>
        ) : null}
        {collapsed ? (
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-line-inverse bg-white/10 text-content-inverse backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-55"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        ) : (
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
        )}
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
// Collapse is a plain UI preference, not access-control or session data --
// unlike ADMIN_ROLE_VARIANT_KEY (auth.ts's per-tab sessionStorage marker
// for disambiguating ADMIN vs SUPER_ADMIN), this is safe to persist in
// localStorage so it survives reloads and applies the same across tabs,
// the same as any other "remember my layout preference" setting.
const SIDEBAR_COLLAPSED_KEY = "se_sidebar_collapsed";

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
  // Starts expanded on both server and first client render (no window
  // during SSR) to avoid a hydration mismatch, then flips from localStorage
  // right after mount -- the one-frame flash this costs is the standard,
  // accepted trade-off for a client-only layout preference like this.
  const [collapsed, setCollapsed] = useState(false);

  // RoleShell doesn't own the fetch that produced `user` (each page's own
  // useProtectedPage() does), so a fresh photo upload from the new profile
  // menu (19 Aug 2026) is applied as a local override here rather than
  // waiting on the parent page to re-fetch -- every avatar in this shell
  // updates instantly instead of only after the next navigation.
  const [photoOverride, setPhotoOverride] = useState<string | null>(null);
  const effectiveUser = photoOverride && user ? { ...user, profilePhotoUrl: photoOverride } : user;
  // Only ADMIN/SUPER_ADMIN have a Security Settings page today (2FA,
  // sessions, data export) -- the profile menu links out to it for them and
  // handles password changes inline for every role instead.
  const hasSecuritySettings = role === "ADMIN" || role === "SUPER_ADMIN";

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

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
      {/* Desktop rail -- collapsible (18 Aug 2026, Shailesh: a full-width
          review window was getting visually trapped next to the sidebar,
          and every role needs a way to reclaim that space, not just this
          one page) -- width transitions smoothly and the choice persists
          across reloads via localStorage. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-300 ease-spring lg:block",
          collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        <SidebarContent
          role={role}
          user={effectiveUser}
          pathname={pathname}
          collapsed={collapsed}
          onSignOut={handleLogout}
          signingOut={signingOut}
          onToggleCollapse={toggleCollapsed}
          onPhotoUpdated={setPhotoOverride}
          hasSecuritySettings={hasSecuritySettings}
        />
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
              user={effectiveUser}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              onSignOut={handleLogout}
              signingOut={signingOut}
              onPhotoUpdated={setPhotoOverride}
              hasSecuritySettings={hasSecuritySettings}
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
      <div
        className={cn(
          "relative transition-[padding] duration-300 ease-spring",
          collapsed ? "lg:pl-sidebar-collapsed" : "lg:pl-sidebar",
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-canvas-glow" />

        {/* Desktop context bar. z-20, deliberately HIGHER than <main>'s z-10
            below (19 Aug 2026, Shailesh: the profile dropdown "underlaps"
            and page text bleeds through it, and its Upload Photo button did
            nothing when clicked). Root cause: this bar and <main> are
            sibling elements with position:relative, and they were BOTH
            z-10 -- equal z-index siblings paint in DOM order, so <main>
            (which comes second) painted OVER the dropdown's absolutely-
            positioned panel wherever the two visually overlapped, even
            though the dropdown itself is z-50. Browsers hit-test clicks in
            the same top-to-bottom paint order, so those overlapped buttons
            (Upload Photo included) were never actually receiving the click
            -- <main>'s content was silently eating it. A stacking context
            can only ever be out-ranked by ITS OWN ancestor's z-index, so
            raising this wrapper's z-index is the fix; z-50 on the dropdown
            panel further down was always irrelevant to the actual bug. */}
        <div className="relative z-20 hidden items-center justify-between gap-4 px-8 pt-7 lg:flex">
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-xs font-medium text-content-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-saffron-500" aria-hidden />
            {ROLE_TAGLINE[role]}
          </span>
          <span className="flex items-center gap-3">
            <Badge tone="brand" dot pulse>
              Session Active
            </Badge>
            {/* Clickable profile menu (19 Aug 2026, Shailesh: "it should be
                clickable and should behave like a user settings panel just
                like we see in every other top notch platform") -- was a
                static pill before. */}
            <UserMenu
              user={effectiveUser}
              role={role}
              onPhotoUpdated={setPhotoOverride}
              hasSecuritySettings={hasSecuritySettings}
              onSignOut={handleLogout}
              signingOut={signingOut}
            />
          </span>
        </div>

        <main className="relative z-10 mx-auto w-full max-w-shell px-4 py-8 sm:px-6 lg:px-8 lg:py-10">{children}</main>

        <footer className="relative z-10 mx-auto w-full max-w-shell px-4 pb-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 border-t border-line pt-5 text-xs text-content-faint sm:flex-row sm:items-center sm:justify-between">
            <span>School Enrichment &middot; CBSE &amp; ICSE, Class 5&ndash;10</span>
            <span>Signed In as {ROLE_LABEL[role]}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
