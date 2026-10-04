"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  KeyRound,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { clearSession, updateStoredUser } from "@/lib/auth";
import { roleLabel } from "@/lib/pageTitle";
import { passwordChecks, passwordProblem } from "@/lib/passwordRules";
import { rememberSignedOut } from "@/lib/sessionNotice";
import { compressImageForUpload } from "@/lib/imageCompression";
import type { CurrentUser, UserRole } from "@/types/auth";
import { cn, initialsFromName } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { PasswordRulesList } from "@/components/ui/PasswordRulesList";

// The role's name comes from lib/pageTitle.ts, the one place it is written.
// This file kept its own copy, which is how the rail went on saying "Admin"
// after the footer and the tab had moved to "School Admin" (3 Oct 2026).

/**
 * Renders the actual uploaded photo when one exists, the initials badge
 * otherwise -- shared by every place an avatar appears so they all update
 * together the instant a new photo is uploaded.
 *
 * Fetches the photo through the authenticated `api` client and displays it
 * via a blob: object URL, rather than pointing a plain <img src="/api/...">
 * straight at the endpoint (30 Sep 2026 fix). The backend endpoint
 * (routes_auth.py's get_profile_photo) picks which of up to four per-role
 * session cookies to check using the X-Auth-Role header -- necessary
 * because ADMIN and SUPER_ADMIN can both be signed in at once in the same
 * browser (see cookies.py). A bare <img> tag can never send that header,
 * so when more than one role's cookie is present -- exactly the case for
 * every account used to build and test this product -- the backend's
 * cookie-scan fallback could silently authenticate the request as a
 * DIFFERENT logged-in role than the one actually viewing the page. The
 * same-school photo-access check (a real security control, the A4 fix)
 * then correctly 404s that mismatched, wrong-account identity -- so the
 * photo one account uploaded would only ever fail to appear for accounts
 * sharing a browser with another role, silently and without an error
 * anywhere, which is exactly what made this hard to catch. Routing the
 * request through `api` guarantees the same X-Auth-Role header every other
 * authenticated call already relies on, so the correct cookie is always
 * selected regardless of what else is signed in alongside it.
 */
function Avatar({
  photoUrl,
  fullName,
  size = "sm",
}: {
  photoUrl?: string | null;
  fullName?: string | null;
  size?: "sm" | "lg";
}) {
  const dimension = size === "lg" ? "h-14 w-14 text-lg" : "h-8 w-8 text-xs";
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoUrl) {
      setObjectUrl(null);
      return;
    }
    let cancelled = false;
    let revokeUrl: string | null = null;

    // `photoUrl` always arrives with a leading "/api/..." (see
    // auth_service.py's public_profile_photo_url and the upload endpoint's
    // response) -- `api`'s own baseURL already contributes that "/api"
    // prefix, so it has to come off here or the request doubles it up into
    // "/api/api/...".
    const path = photoUrl.startsWith("/api/") ? photoUrl.slice(4) : photoUrl;
    api
      .get(path, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelled) return;
        revokeUrl = URL.createObjectURL(data as Blob);
        setObjectUrl(revokeUrl);
      })
      .catch(() => {
        // A genuine 404 (no photo yet) or any other failure both just fall
        // back to the initials badge -- never a broken-image icon.
        if (!cancelled) setObjectUrl(null);
      });

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [photoUrl]);

  if (objectUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a locally-generated blob: object URL, not a remote asset next/image could optimize.
      <img
        src={objectUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-inset ring-white/20", dimension)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-brand-gradient font-bold text-white",
        dimension,
      )}
    >
      {initialsFromName(fullName)}
    </span>
  );
}

interface UserMenuBodyProps {
  user: CurrentUser | null;
  role: UserRole;
  hasSecuritySettings: boolean;
  onPhotoUpdated: (photoUrl: string) => void;
  onClose: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}

/** The actual dropdown content -- avatar, photo upload, change password,
 *  a link out to full Security Settings (ADMIN/SUPER_ADMIN only, the only
 *  two roles that have one), and sign out. Shared by both trigger styles
 *  below so the desktop context-bar pill and the sidebar identity card
 *  never drift out of sync with each other.
 *
 *  Wires up two backend capabilities that already existed but were never
 *  surfaced anywhere in the UI: POST /api/auth/profile-photo (tested, works
 *  for every role) and POST /api/auth/change-password (also role-agnostic).
 *  TEACHER and STUDENT have no Security Settings page, so this panel is
 *  where they change a password they already chose. (Replacing the one the
 *  school issued is a different moment with its own screen, required at
 *  first sign-in: components/ChoosePassword.tsx.)
 */
function UserMenuBody({ user, role, hasSecuritySettings, onPhotoUpdated, onClose, onSignOut, signingOut }: UserMenuBodyProps) {
  const [view, setView] = useState<"menu" | "password">("menu");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  // The rules a new password has to meet, shown as a checklist that fills
  // in while it is typed (4 Oct 2026). This form had one line of hint, "8+
  // characters, a letter and a number", which is three of the server's
  // rules and not the two people actually trip on (it must not be a common
  // word, and it must differ from the current one) -- so a teacher or a
  // student could meet the hint and still be refused. It is the list the
  // first-password step (ChoosePassword) and the admin's Security Settings
  // already show, from the same source: lib/passwordRules.ts.
  const rulesId = useId();
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  // Rules are shown neutrally until the person has tried to save; after
  // that, the ones still unmet are marked as what is holding things up.
  const [passwordAttempted, setPasswordAttempted] = useState(false);
  const passwordRuleChecks = passwordChecks(newPassword, { current: currentPassword || null, replacing: "current" });

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    setPhotoError(null);
    setUploadingPhoto(true);

    // Resize/re-encode in the browser first (19 Aug 2026, Shailesh: "we
    // never know what image the user is gonna upload so we need to keep
    // that in mind always") -- a raw phone-camera photo is routinely
    // 3-10MB, and the backend's limit used to reject almost every real
    // upload with a message that claimed compression had already happened
    // when none ever did. See lib/imageCompression.ts for the full story.
    // This can fail on its own (an unsupported format, a corrupted file) --
    // caught separately from the upload itself so that error surfaces
    // clearly instead of as a confusing size/format rejection from the API.
    let compressed: File;
    try {
      compressed = await compressImageForUpload(file);
    } catch (err) {
      // compressImageForUpload throws UserFacingErrors, whose wording is
      // shown as written; anything else is an exception from the browser,
      // whose text never is (lib/errors.ts).
      setPhotoError(errorMessage(err, "prepare that photo"));
      setUploadingPhoto(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", compressed);
      // No explicit Content-Type header -- axios/the browser need to set
      // this themselves so it includes the multipart boundary that comes
      // from the FormData object; hardcoding "multipart/form-data" here
      // would strip that boundary and the backend would fail to parse the
      // upload at all.
      const { data } = await api.post<{ photoUrl: string; user: CurrentUser }>("/auth/profile-photo", formData);
      updateStoredUser(data.user);
      onPhotoUpdated(data.photoUrl);
    } catch (err) {
      setPhotoError(errorMessage(err, "update your photo"));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordAttempted(true);
    // Checked here first, in the order the boxes are in, so nobody presses
    // the button to learn their password was a character short. The server
    // checks all of it again (core/security.py, strong_password_issue).
    // The same order and the same sentences as the admin's form.
    if (!currentPassword) {
      setPasswordError("Enter your current password, so we know it's you.");
      currentPasswordRef.current?.focus();
      return;
    }
    const problem = passwordProblem(newPassword, { current: currentPassword, replacing: "current" });
    if (problem) {
      setPasswordError(problem);
      newPasswordRef.current?.focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(
        confirmPassword
          ? "The two passwords don't match. Type your new password again in the last box."
          : "Type your new password once more in the last box.",
      );
      confirmPasswordRef.current?.focus();
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setPasswordSuccess(true);
      // A password change invalidates the session that issued the request
      // (see backend/app/dependencies.py's password_changed_at check) -- the
      // current cookie is already effectively dead, so send the user back
      // to a real login instead of leaving a broken session sitting open.
      window.setTimeout(() => {
        clearSession();
        rememberSignedOut({ message: "Your password has been changed. Sign in with your new password." });
        window.location.href = "/login";
      }, 1800);
    } catch (err) {
      setPasswordError(errorMessage(err, "change your password"));
    } finally {
      setChangingPassword(false);
    }
  }

  if (view === "password") {
    return (
      // noValidate: the checks above say what is wrong in the product's own
      // words, in the order of the boxes; the browser's own bubbles would
      // get in first with theirs.
      <form method="post" onSubmit={handleChangePassword} className="space-y-4" noValidate>
        <button
          type="button"
          onClick={() => setView("menu")}
          className="text-[0.8125rem] font-semibold text-content-subtle transition hover:text-content-brand"
        >
          &larr; Back
        </button>
        <TextField
          ref={currentPasswordRef}
          id={`userMenuCurrentPassword-${role}`}
          name="currentPassword"
          label="Current Password"
          type="password"
          autoComplete="current-password"
          revealable
          required
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
            setPasswordError(null);
          }}
        />
        <div className="space-y-2.5">
          <TextField
            ref={newPasswordRef}
            id={`userMenuNewPassword-${role}`}
            name="newPassword"
            label="New Password"
            type="password"
            autoComplete="new-password"
            revealable
            required
            aria-describedby={rulesId}
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              // What the message said was about what was typed before.
              setPasswordError(null);
            }}
          />
          {/* One column: the menu is too narrow for two. */}
          <PasswordRulesList id={rulesId} checks={passwordRuleChecks} attempted={passwordAttempted} columns={1} />
        </div>
        <TextField
          ref={confirmPasswordRef}
          id={`userMenuConfirmPassword-${role}`}
          name="confirmPassword"
          label="Confirm New Password"
          type="password"
          autoComplete="new-password"
          revealable
          required
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setPasswordError(null);
          }}
        />
        {passwordError ? (
          <p role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {passwordError}
          </p>
        ) : null}
        {passwordSuccess ? (
          <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-jade-700">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Password updated. Signing you out&hellip;
          </p>
        ) : null}
        <Button type="submit" size="sm" fullWidth loading={changingPassword} loadingLabel="Updating">
          Update Password
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar photoUrl={user?.profilePhotoUrl} fullName={user?.fullName} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-content">{user?.fullName ?? "Signed in"}</p>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-content-brand">
            {roleLabel(role, user?.admin?.schoolName)}
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        // Any image, not just the three formats the backend ultimately
        // stores -- compressImageForUpload() re-encodes whatever it can
        // decode to JPEG in the browser first, so this doesn't need to be
        // narrowed to what the backend accepts (19 Aug 2026: "we never know
        // what image the user is gonna upload so we need to keep that in
        // mind always").
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        fullWidth
        leadingIcon={<Camera className="h-4 w-4" />}
        loading={uploadingPhoto}
        loadingLabel="Uploading"
        onClick={() => fileInputRef.current?.click()}
      >
        {user?.profilePhotoUrl ? "Change Photo" : "Upload Photo"}
      </Button>
      {photoError ? (
        <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {photoError}
        </p>
      ) : null}

      <div className="space-y-1 border-t border-line pt-3">
        {/* An admin changes theirs on Security Settings, linked just below:
            that form shows every rule as it is typed and, for a password
            that was issued, keeps them signed in for two-factor setup. A
            second, plainer form here did neither, and signed a new admin
            out part-way through (3 Oct 2026). Teachers and students have
            no such page, so this is theirs. */}
        {hasSecuritySettings ? null : (
          <button
            type="button"
            role="menuitem"
            onClick={() => setView("password")}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-content transition hover:bg-surface-muted"
          >
            <KeyRound className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden />
            Change Password
          </button>
        )}
        {hasSecuritySettings ? (
          <Link
            href="/admin/security"
            role="menuitem"
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-content transition hover:bg-surface-muted"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden />
            Security Settings
          </Link>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={onSignOut}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-coral-700 transition hover:bg-coral-50 disabled:pointer-events-none disabled:opacity-55"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          {signingOut ? "Signing Out…" : "Sign Out"}
        </button>
      </div>
    </div>
  );
}

/** Trigger + panel for the light desktop context bar (19 Aug 2026, Shailesh:
 * "it should be clickable and should behave like a user settings panel just
 * like we see in every other top notch platform"). */
export function UserMenu({
  user,
  role,
  onPhotoUpdated,
  hasSecuritySettings,
  onSignOut,
  signingOut,
}: {
  user: CurrentUser | null;
  role: UserRole;
  /** Lets RoleShell keep its own copy of `user` in sync after a photo
   *  upload, since RoleShell doesn't own the fetch that produced `user` in
   *  the first place -- each page's useProtectedPage() does. */
  onPhotoUpdated: (photoUrl: string) => void;
  hasSecuritySettings: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full border border-line bg-surface/80 py-1.5 pl-1.5 pr-3.5 shadow-xs backdrop-blur transition hover:border-brand-300 hover:bg-surface"
      >
        <Avatar photoUrl={user?.profilePhotoUrl} fullName={user?.fullName} />
        <span className="max-w-[9rem] truncate text-sm font-semibold text-content sm:max-w-[14rem]">
          {user?.fullName ?? "Signed in"}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-content-faint transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[20rem] animate-scale-in rounded-3xl border border-line bg-surface p-4 shadow-panel"
        >
          <UserMenuBody
            user={user}
            role={role}
            hasSecuritySettings={hasSecuritySettings}
            onPhotoUpdated={onPhotoUpdated}
            onClose={() => setOpen(false)}
            onSignOut={onSignOut}
            signingOut={signingOut}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Same menu, styled as the dark sidebar identity card instead of the light
 *  context-bar pill -- covers the mobile drawer and the desktop rail, where
 *  UserMenu above isn't rendered at all (RoleShell.tsx only shows the
 *  desktop context bar at `lg` and up). */
export function SidebarUserMenu({
  user,
  role,
  onPhotoUpdated,
  hasSecuritySettings,
  onSignOut,
  signingOut,
  collapsed,
}: {
  user: CurrentUser | null;
  role: UserRole;
  onPhotoUpdated: (photoUrl: string) => void;
  hasSecuritySettings: boolean;
  onSignOut: () => void;
  signingOut: boolean;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const who = roleLabel(role, user?.admin?.schoolName);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? `${user?.fullName ?? "Signed in"} · ${who}` : undefined}
        className={cn(
          "glass-panel flex w-full items-center gap-3 rounded-2xl transition hover:bg-white/[0.1]",
          collapsed ? "justify-center px-2 py-2" : "px-3.5 py-3",
        )}
      >
        <Avatar photoUrl={user?.profilePhotoUrl} fullName={user?.fullName} />
        {!collapsed ? (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-semibold text-content-inverse">
              {user?.fullName ?? "Signed in"}
            </span>
            {/* Up to two lines. A school admin's label carries the school's
                name, and the rail fits about eighteen of these letter-spaced
                capitals to a line: "RIVERSIDE ACADEMY ADMIN" was being cut
                to "RIVERSIDE ACADEMY A...". The longest label there can be
                (lib/pageTitle.ts) fits in two. */}
            <span className="mt-0.5 block text-[0.6875rem] font-semibold uppercase leading-[1.3] tracking-eyebrow text-saffron-300 text-pretty break-words line-clamp-2">
              {who}
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 w-[18rem] animate-scale-in rounded-3xl border border-line bg-surface p-3 shadow-panel",
            collapsed ? "left-0" : "left-0 right-0",
          )}
        >
          <UserMenuBody
            user={user}
            role={role}
            hasSecuritySettings={hasSecuritySettings}
            onPhotoUpdated={onPhotoUpdated}
            onClose={() => setOpen(false)}
            onSignOut={onSignOut}
            signingOut={signingOut}
          />
        </div>
      ) : null}
    </div>
  );
}
