"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
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
import { api, describeApiError } from "@/lib/api";
import { wasRefused } from "@/lib/errors";
import { clearSession } from "@/lib/auth";
import { PRODUCT_CREDIT, PRODUCT_NAME } from "@/lib/brand";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { ROLE_LABEL, roleLabel } from "@/lib/pageTitle";
import type { CurrentUser, UserRole } from "@/types/auth";
import { cn } from "@/lib/utils";
import { Ambience, type AmbienceLevel } from "@/components/brand/Ambience";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { UserMenu, SidebarUserMenu } from "@/components/UserMenu";

// roleLabel() (Title Case throughout) is the single source every surface in
// RoleShell reads from -- rail title, user card, mobile top bar, footer --
// and, since 3 Oct 2026, the browser tab too, which is why it lives in
// lib/pageTitle.ts. Since 4 Oct 2026 it names a school admin after their
// school ("MathPath Admin"). SUPER_ADMIN used to collapse to "Admin" here, which was
// the real cause of a platform admin's tab looking visually identical to a
// school admin's (18 Aug 2026, Shailesh: two tabs signed into different
// admin variants at once still "ended up as either admin or super admin,
// not both together" -- the underlying per-tab session was actually fine,
// but nothing on screen ever showed the difference, so it read as broken).

const ROLE_TAGLINE: Record<UserRole, string> = {
  ADMIN: "School Control Centre",
  SUPER_ADMIN: "Platform Control Centre",
  TEACHER: "Teaching Workspace",
  STUDENT: "Your Learning Space",
};

/**
 * The line at the foot of the rail (3 Oct 2026). It used to read "Need
 * help? Ask your school coordinator." for all four roles -- a role that
 * does not exist in this product, and the wrong person for three of them.
 * Each role is now pointed at whoever can actually do something for them:
 * a teacher sets a student's work and can grant attempts; a school admin
 * manages teachers' accounts and sections; admins are managed by the
 * platform (routes_roster.py). A Super Admin has nobody above them inside
 * the product, so their line says what their access means instead of
 * pretending there is someone to ask.
 */
const HELP_LINE: Record<UserRole, { text: string; icon: React.ComponentType<{ className?: string }> }> = {
  STUDENT: { text: "Stuck on something? Ask your teacher.", icon: LifeBuoy },
  TEACHER: { text: "Need a hand? Ask your school admin.", icon: LifeBuoy },
  ADMIN: { text: "Need a hand? Contact your platform administrator.", icon: LifeBuoy },
  SUPER_ADMIN: { text: "Platform-wide access: changes here reach every school.", icon: ShieldCheck },
};

/**
 * Where this person is signed in, for the footer: their school, and for a
 * student their class and section too. A Super Admin belongs to no school.
 */
function signedInPlace(role: UserRole, user: CurrentUser | null): string | null {
  if (role === "SUPER_ADMIN") return "All schools";
  if (!user) return null;
  if (role === "STUDENT") {
    const classAndSection = [user.student?.className, user.student?.section].filter(Boolean).join(" ");
    return [classAndSection, user.student?.schoolName].filter(Boolean).join(", ") || null;
  }
  if (role === "TEACHER") return user.teacher?.schoolName || null;
  return user.admin?.schoolName || null;
}

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
        { label: "Daily Practice", icon: Target, href: "/student/practice" },
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
        // 1 Oct 2026: the old single "Assignments" page (assign form,
        // results list and a results modal on one screen) is now two
        // routes -- setting practice and reviewing it are different jobs.
        // "Marking" stopped being a placeholder the same day: written
        // answers are marked in the tracker's Needs Review tab, so it no
        // longer gets a row of its own.
        { label: "Assign Practice", icon: ClipboardList, href: "/teacher/assign" },
        { label: "Practice Tracker", icon: ClipboardCheck, href: "/teacher/tracker" },
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
  // The same rows as a school admin's, because they are the same screens;
  // what differs is whose they are. The first group is "Platform": a Super
  // Admin's dashboard and People page are about every school, and a rail
  // that filed them under "School" was the last place a Super Admin's
  // screen still read as a school admin's with a different badge.
  SUPER_ADMIN: [
    {
      section: "Platform",
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

/**
 * A nav item is active on its own route *and* anything beneath it, so a
 * student inside /student/practice/<id> still sees "Daily Practice" lit in
 * the rail and named in the breadcrumb. Exact-match only (the previous
 * behaviour) left the rail with nothing highlighted mid-attempt, which reads
 * as "you are nowhere". No two hrefs in NAV are prefixes of each other, so
 * this can never light two rows at once.
 */
function isActiveHref(href: string | undefined, pathname: string) {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Detail views that get the whole screen (1 Oct 2026, Practice Tracker):
 * one assignment's class list, one student's history, one attempt being
 * marked. On these routes the desktop rail collapses to its icon column
 * automatically and the content column drops its max width, so a wide
 * table or a marking screen isn't squeezed beside the navigation -- the
 * same mechanism the MathPath reference uses for its per-student route
 * (PROJECT_REFERENCE.md). Matching is by route pattern, so any future
 * detail route opts in by being added here, not by each page toggling the
 * shell. The user's own saved collapse preference is untouched: leaving a
 * focus route restores whatever they had.
 */
const FOCUS_ROUTES: RegExp[] = [/^\/teacher\/tracker\/(assignments|students|attempts)\/[^/]+\/?$/];

function isFocusRoute(pathname: string) {
  return FOCUS_ROUTES.some((pattern) => pattern.test(pathname));
}

function currentNavItem(role: UserRole, pathname: string): NavItem | null {
  for (const group of NAV[role]) {
    for (const item of group.items) {
      if (isActiveHref(item.href, pathname)) return item;
    }
  }
  return null;
}

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
          // Inactive live rows sit at inverse-muted (5.7:1 at the rail's
          // lightest point; was raw white/70). The active row's white/12
          // fill only started rendering once `12` joined the opacity scale
          // in tailwind.config.ts -- it had been ring-only until then.
          active
            ? "bg-white/12 font-semibold text-content-inverse shadow-hairline ring-1 ring-inset ring-white/15"
            : "text-content-inverse-muted hover:bg-white/[0.08] hover:text-content-inverse",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition duration-200 ease-spring",
            active
              ? "bg-accent-gradient text-brand-950 shadow-accent"
              : "bg-white/[0.08] ring-1 ring-inset ring-white/10 group-hover:bg-white/[0.14] group-hover:ring-white/20",
          )}
        >
          {/* A hair of lift on hover, on the icon only -- the row stays
              put, so the list never looks like it is shifting under the
              cursor. */}
          <Icon className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:-translate-y-px" />
        </span>
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  return (
    <span
      aria-disabled="true"
      title={`${item.label}: coming soon`}
      // Quieter than a live row, but only down to the inverse-faint floor
      // (4.6:1; was white/55 at ~3.7:1). The hierarchy now comes from the
      // dimmed icon plate and the Soon pill, not from unreadable text.
      className={cn(base, "cursor-default text-content-inverse-faint hover:bg-white/[0.05] hover:text-content-inverse-muted")}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] opacity-80 ring-1 ring-inset ring-white/[0.08]">
        <Icon className="h-4 w-4" />
      </span>
      {!collapsed ? (
        <>
          {/* May run to a second line. With the pill beside it there is
              room for about fourteen characters, and "Classes & Sections"
              was being cut to "Classes & Secti..." -- a name nobody can
              read is worse than a row one line taller. */}
          <span className="min-w-0 leading-[1.25] text-pretty">{item.label}</span>
          {/* inverse-muted on the white/10 pill: 4.6:1 (was white/60, ~3.4:1). */}
          <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-eyebrow text-content-inverse-muted">
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
  inDrawer = false,
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
  /** The mobile drawer overlays its own close button in the top-right
   *  corner; this reserves room for it so it never sits on the wordmark. */
  inDrawer?: boolean;
}) {
  const help = HELP_LINE[role];
  const HelpIcon = help.icon;
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-brand-gradient">
      {/* Deliberately static -- the sign-in page's slow-moving night is a
          first-impression moment, but this rail sits in peripheral vision
          for a whole school day, where ambient motion is a distraction. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute bottom-10 right-[-4rem] h-56 w-56 rounded-full bg-saffron-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-grid-inverse opacity-60" />
        {/* Film grain, the same as the mastheads carry, so the dark
            surfaces a user sees read as one material. */}
        <div className="bg-grain absolute inset-0" />
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
          inDrawer && "pr-16",
        )}
      >
        {collapsed ? <LogoMark variant="inverse" className="h-9 w-9" /> : <Lockup tone="light" showTagline />}
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
        {NAV[role].map((group, index) => (
          // A named group, so a screen reader hears "School, group" before
          // its rows -- including in the collapsed rail, where the visible
          // label is gone. The visible label is aria-hidden to avoid it
          // being read twice.
          <div key={group.section} role="group" aria-label={group.section} className="space-y-1">
            {!collapsed ? (
              // inverse-faint (4.6:1) -- was white/40, which measured 2.7:1.
              <p aria-hidden className="px-3 pb-1 text-[0.625rem] font-bold uppercase tracking-eyebrow text-content-inverse-faint">
                {group.section}
              </p>
            ) : index > 0 ? (
              // Collapsed: the section label can't fit, but the grouping
              // still matters, so it becomes a short rule. Without it the
              // icon column reads as one undifferentiated list of eight.
              <span aria-hidden className="mx-auto mb-2 block h-px w-7 bg-white/15" />
            ) : null}
            {group.items.map((item) => (
              <NavRow
                key={item.label}
                item={item}
                active={isActiveHref(item.href, pathname)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className={cn("relative space-y-3 border-t border-white/10 py-5", collapsed ? "px-3" : "px-5")}>
        {!collapsed ? (
          // items-start + a nudged icon: at the rail's width this line wraps
          // to two, and a centred icon then floats between them.
          // inverse-faint (4.6:1) -- was white/55 at ~3.7:1.
          <p className="flex items-start gap-2 text-xs leading-relaxed text-content-inverse-faint">
            <HelpIcon className="mt-[0.2rem] h-3.5 w-3.5 shrink-0" aria-hidden />
            {help.text}
          </p>
        ) : null}
        {collapsed ? (
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            aria-label="Sign Out"
            title="Sign Out"
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
            Sign Out
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

/**
 * The frosted chip the breadcrumb already sits on (border-line, surface at
 * 70%, shadow-xs, backdrop-blur), as a constant so the two other pieces of
 * shell text that used to sit on the bare canvas can share it when a page
 * has an ambience behind it: the date line and the footer.
 *
 * Why they need it. Both are content-subtle at 12px, the quietest text in
 * the shell. On the bare canvas, against the darkest pixel the workspace
 * wash puts behind a page, content-subtle measures 3.8:1 at the dashboard
 * level and 4.0:1 at the working one -- under AA, and the reason Phase A's
 * wash had to stay at a quarter strength. On this chip (surface at 70%
 * over that same darkest pixel, taking no credit for the blur) it is 5.5:1
 * and 5.6:1; content-muted, the breadcrumb's parent crumb, 7.5:1; the
 * calendar glyph, content-faint and decorative, 4.0:1.
 * components/brand/Ambience.tsx has the sweep those figures come from.
 */
const SURFACED = "border border-line bg-surface/70 shadow-xs backdrop-blur";

export function RoleShell({
  role,
  user,
  title,
  ambience,
  children,
}: {
  role: UserRole;
  user: CurrentUser | null;
  /**
   * What the browser tab calls this page (lib/pageTitle.ts). Leave it out
   * and the tab is named after the navigation item the page belongs to --
   * "Practice Tracker", "People" -- which is right for every top-level
   * page. A detail view passes its own, most specific part first:
   * `title={[student.name, "Practice Tracker"]}`. Parts that are still
   * loading may be undefined; they are dropped until they arrive.
   */
  title?: string | Array<string | null | undefined>;
  /**
   * Opts this page into the workspace colour wash, at one of its two
   * levels (components/brand/Ambience.tsx has what each is and the contrast
   * measurements behind them). Off by default: a page that doesn't pass it
   * renders exactly as it did before the prop existed -- today that is
   * every Admin and Student page, and the three tracker detail views.
   *
   * It is a prop on the shell, rather than something a page drops into its
   * own content, because turning the wash up is only safe once nothing
   * quiet is left sitting on the bare canvas -- and two of the things that
   * were are the shell's own: the date beside the breadcrumb and the
   * footer line, both content-subtle. With `ambience` set they move onto
   * the same frosted chip the breadcrumb already uses (SURFACED, above).
   * One prop does both, so a page cannot have the stronger wash without
   * the surfaces that make it safe.
   */
  ambience?: AmbienceLevel;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // Starts expanded on both server and first client render (no window
  // during SSR) to avoid a hydration mismatch, then flips from localStorage
  // right after mount -- the one-frame flash this costs is the standard,
  // accepted trade-off for a client-only layout preference like this.
  const [collapsed, setCollapsed] = useState(false);
  // Today's date for the context bar. Client-only for the same reason as
  // `collapsed`: these pages are prerendered at build time, so a date
  // computed during render would be the *build's* date, frozen into the
  // HTML until the next deploy -- and the server has no idea of the
  // viewer's timezone anyway. It fades in a beat after mount instead.
  const [today, setToday] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

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
    setToday(
      new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date()),
    );
  }, []);

  // The mobile drawer behaves like the Modal it is documented alongside:
  // Escape closes it, the page behind it doesn't scroll, focus moves into
  // it on open (onto its close button, the one control guaranteed to be
  // there) and returns to the menu button on close. Before this, it had
  // none of those, despite Modal.tsx describing them as shared conventions.
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerCloseRef.current?.focus({ preventScroll: true });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    const trigger = menuButtonRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  const currentItem = currentNavItem(role, pathname);
  const who = roleLabel(role, user?.admin?.schoolName);
  usePageTitle(title ?? currentItem?.label, role, user?.admin?.schoolName);
  // The footer says who and where. A school admin's label already names
  // the school, so saying it again after the dot would be an echo.
  const place = role === "ADMIN" && who !== ROLE_LABEL.ADMIN ? null : signedInPlace(role, user);
  const focusRoute = isFocusRoute(pathname);
  // On a focus route the rail starts collapsed; the toggle can still open
  // it for this visit, but that choice is not saved -- it resets on the
  // next navigation, and the saved preference is never overwritten.
  const [focusExpanded, setFocusExpanded] = useState(false);
  useEffect(() => {
    setFocusExpanded(false);
  }, [pathname]);
  const railCollapsed = focusRoute ? !focusExpanded : collapsed;

  function toggleCollapsed() {
    if (focusRoute) {
      setFocusExpanded((prev) => !prev);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  /**
   * Signing out has to end the session on the server: the session lives in
   * an httpOnly cookie this page cannot clear by itself. Until 3 Oct 2026 a
   * sign-out request that never reached the server still sent the person to
   * the sign-in page as though it had worked -- on a shared school computer
   * the next person could open a link and be inside that account. If the
   * request fails now, they stay where they are and are told so. What they
   * are told depends on what is known: a refusal from the server means they
   * are certainly still signed in; a request that got no answer may or may
   * not have landed, so that one says to treat the device as signed in
   * until signing out works. (A session the server says is already over is
   * as signed out as it gets; that carries on to the sign-in page.)
   */
  async function handleLogout() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await api.post("/auth/logout");
    } catch (error) {
      const problem = describeApiError(error, "sign you out");
      if (problem.kind !== "session") {
        setSignOutError(
          `${problem.message} ${
            wasRefused(problem)
              ? "You're still signed in on this device."
              : "Until signing out works, treat this device as still signed in."
          }`,
        );
        setSigningOut(false);
        setMenuOpen(false);
        return;
      }
    }
    clearSession();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Keyboard users land here first on every page and can jump straight
          past the rail's dozen-odd stops to the content. Invisible until
          focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-content-brand focus:shadow-panel"
      >
        Skip to content
      </a>

      {/* Desktop rail -- collapsible (18 Aug 2026, Shailesh: a full-width
          review window was getting visually trapped next to the sidebar,
          and every role needs a way to reclaim that space, not just this
          one page) -- width transitions smoothly and the choice persists
          across reloads via localStorage. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden shadow-rail transition-[width] duration-300 ease-spring lg:block",
          railCollapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        <SidebarContent
          role={role}
          user={effectiveUser}
          pathname={pathname}
          collapsed={railCollapsed}
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
            <span className="font-display text-base font-semibold leading-none tracking-[-0.015em] text-content">{PRODUCT_NAME}</span>
            {/* The longest label there can be (28 characters) fits whole
                from 360px up; on a 320px phone the letter spacing closes up
                so it still does. */}
            <span className="max-w-[60vw] truncate text-[0.625rem] font-bold uppercase tracking-eyebrow text-content-brand max-[359px]:tracking-[0.03em]">
              {who}
            </span>
          </span>
        </span>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line-strong bg-surface text-content-muted transition hover:border-brand-300 hover:text-content-brand active:scale-95"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          {/* tabIndex -1: the backdrop is a pointer target only. The
              visible close button is the keyboard route out, and Escape
              works too -- two tab stops that do the same thing is noise. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-brand-950/55 backdrop-blur-sm animate-fade-in"
          />
          {/* Slides in from the edge it is anchored to (sheet-in), rather
              than fading up in place. */}
          <div className="absolute inset-y-0 left-0 w-[min(20rem,86vw)] animate-sheet-in shadow-panel">
            <SidebarContent
              inDrawer
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
              ref={drawerCloseRef}
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-4 top-5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-content-inverse-muted ring-1 ring-inset ring-white/15 transition hover:bg-white/20 hover:text-content-inverse"
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
          railCollapsed ? "lg:pl-sidebar-collapsed" : "lg:pl-sidebar",
        )}
      >
        {/* mask-fade-b: the glow used to stop dead at 26rem, leaving a faint
            horizontal seam across the page right behind the first row of
            cards. It now dissolves into the canvas instead. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-canvas-glow mask-fade-b" />

        {/* The workspace wash, when a page asks for one. Pinned to the
            viewport (Ambience is `fixed`) but starting at the rail's right
            edge rather than the screen's, so its top-left blob sits on the
            content column's corner instead of almost entirely underneath
            the rail -- and it follows the rail when that collapses, on the
            same 300ms spring as the column's own padding (which the global
            reduced-motion override makes instant). No z-index: it comes
            before the context bar, <main> and the footer in the DOM and all
            three are positioned with a z-index of their own, so it paints
            beneath them. */}
        {ambience ? (
          <Ambience
            level={ambience}
            className={cn(
              "transition-[left] duration-300 ease-spring",
              railCollapsed ? "lg:left-sidebar-collapsed" : "lg:left-sidebar",
            )}
          />
        ) : null}

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
          {/* Where am I, and when. The workspace chip is now the root of a
              breadcrumb ending in the current page -- it used to repeat the
              page header's eyebrow word-for-word directly beneath it -- and
              today's date sits beside it, because a school runs on the
              timetable and the day is the first thing anyone orients by. */}
          <span className="flex min-w-0 items-center gap-4">
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-surface/70 py-1.5 pl-3 pr-3.5 text-xs font-medium text-content-muted shadow-xs backdrop-blur">
                <li className="flex shrink-0 items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-saffron-500" aria-hidden />
                  {ROLE_TAGLINE[role]}
                </li>
                {currentItem ? (
                  <li className="flex min-w-0 items-center gap-2">
                    <ChevronRight className="h-3 w-3 shrink-0 text-content-faint" aria-hidden />
                    <span aria-current="page" className="truncate font-semibold text-content">
                      {currentItem.label}
                    </span>
                  </li>
                ) : null}
              </ol>
            </nav>
            {today ? (
              // content-subtle on the paper canvas: 6.0:1. With an ambience
              // behind the page it sits on a chip instead (SURFACED).
              <span
                className={cn(
                  "hidden shrink-0 items-center gap-1.5 text-xs font-medium text-content-subtle animate-fade-in xl:flex",
                  ambience && cn(SURFACED, "rounded-full py-1.5 pl-3 pr-3.5"),
                )}
              >
                <CalendarDays className="h-3.5 w-3.5 text-content-faint" aria-hidden />
                {today}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {/* success (jade), not brand: jade is this system's "all good"
                colour. */}
            <Badge tone="success" dot pulse>
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

        {/* tabIndex -1 so the skip link can actually move focus here, not
            just scroll; outline-none because a ring round the whole page on
            arrival would look like an error. */}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "relative z-10 mx-auto w-full px-4 py-8 outline-none sm:px-6 lg:px-8 lg:py-10",
            focusRoute ? "max-w-none 2xl:px-12" : "max-w-shell",
          )}
        >
          {children}
        </main>

        <footer
          className={cn(
            "relative z-10 mx-auto w-full px-4 pb-10 sm:px-6 lg:px-8",
            focusRoute ? "max-w-none 2xl:px-12" : "max-w-shell",
          )}
        >
          {/* content-subtle, not content-faint: faint is 4.6:1 on white but
              4.4:1 on this paper canvas, just under AA at 12px. */}
          <div
            className={cn(
              "flex flex-col gap-2 text-xs text-content-subtle sm:flex-row sm:items-center sm:justify-between",
              // With an ambience, the rule above the footer becomes the
              // chip's own edge.
              ambience ? cn(SURFACED, "rounded-2xl px-4 py-3") : "border-t border-line pt-5",
            )}
          >
            <span className="flex items-center gap-2">
              {/* aria-hidden wrapper: the mark is labelled with the
                  product's name and the same word follows as text. */}
              <span aria-hidden className="inline-flex">
                <LogoMark className="h-4 w-4" />
              </span>
              {PRODUCT_NAME} &middot; {PRODUCT_CREDIT}
            </span>
            {/* Who and where, not just which kind of account: with a teacher,
                a student and two admins open side by side, "Signed In as
                Admin" did not say which school. */}
            <span>
              Signed in as {who}
              {place ? <> &middot; {place}</> : null}
            </span>
          </div>
        </footer>
      </div>

      {/* Above everything, including the mobile drawer's layer: whichever
          Sign out was pressed (rail, drawer or profile menu), this is where
          the answer appears if it did not work. */}
      {signOutError ? (
        <div className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-xl">
          <AlertBanner
            tone="error"
            message={signOutError}
            className="shadow-panel"
            action={
              <button
                type="button"
                onClick={() => setSignOutError(null)}
                aria-label="Dismiss"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-coral-700 transition hover:bg-coral-100"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
