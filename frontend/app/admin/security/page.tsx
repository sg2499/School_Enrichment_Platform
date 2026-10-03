"use client";

/**
 * Security Settings for ADMIN and SUPER_ADMIN: two-factor, sessions, data
 * export and password -- and the page useProtectedPage redirects a brand-new
 * admin to (?passwordChange=required, then ?setup=required) before anything
 * else in the product will load for them.
 *
 * Phase 2a pass (30 Sep 2026). The handlers and every gate below are
 * unchanged; what changed is the order and what the page says up front:
 *  - A posture summary opens the page (password, two-factor, signed-in
 *    devices), so the state of the account is readable before any detail.
 *  - When a password change is forced, the Change Password card now comes
 *    *first*. It used to sit at the very bottom, under a two-factor card
 *    whose only content was "change your password below first" -- the one
 *    thing a locked-out new admin had to do was the last thing on the page.
 *  - Two-factor setup shows where you are in it (a three-step marker).
 *  - "Sign Out of All Devices" asks once before ending every session.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileJson,
  KeyRound,
  Laptop,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeInput, type CodeInputHandle } from "@/components/ui/CodeInput";
import { TextField } from "@/components/ui/Field";
import { PasswordRulesList } from "@/components/ui/PasswordRulesList";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SessionGate } from "@/components/SessionGate";
import { api, describeApiError, errorMessage } from "@/lib/api";
import { clearSession, updateStoredUser } from "@/lib/auth";
import { PRODUCT_NAME, PRODUCT_SLUG } from "@/lib/brand";
import { wasRefused } from "@/lib/errors";
import { passwordChecks, passwordProblem } from "@/lib/passwordRules";
import { rememberSignedOut } from "@/lib/sessionNotice";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types/auth";

type SetupStage = "idle" | "scan" | "codes";

interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  isCurrent: boolean;
}

/** Rough, best-effort device label from the raw User-Agent string -- good
 * enough for "which of my devices is this", not meant to be a precise
 * client-hints-grade parse. Falls back to "Unrecognised device" for anything
 * that doesn't match (scripts, unusual clients). */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unrecognised device";
  const ua = userAgent.toLowerCase();
  const isMobile = /iphone|android|mobile/.test(ua);
  let browser = "Browser";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/")) browser = "Chrome";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("safari/")) browser = "Safari";
  let os = "";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os")) os = "Mac";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  else if (ua.includes("linux")) os = "Linux";
  return [browser, os].filter(Boolean).join(" on ") || (isMobile ? "Mobile device" : "Desktop device");
}

/** "3 min ago" for a server timestamp. The backend serialises aware
 *  datetimes with isoformat(), which ends in "+00:00", never "Z" -- this used
 *  to test only for a trailing "Z", so every real timestamp became
 *  "...+00:00Z", parsed to NaN, and every session read "Active NaN days ago"
 *  (1 Oct 2026). Zone detection is deliberately the same as lib/tracker.ts's
 *  formatDateTime -- keep the two in step: a "Z" or an offset is used as
 *  sent, a bare timestamp is the backend's UTC. Anything still unparseable
 *  comes back as null ("Last active not recorded" on screen), never NaN. */
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const then = new Date(hasZone ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(then)) return null;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

/** Inline error line used by every form on this page. role="alert" so a
 *  failed 2FA code or wrong password is announced, not just painted.
 *  coral-700 on white: 7.3:1. */
function FormError({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700 animate-fade-in">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** Shared block for showing a freshly generated set of backup codes exactly
 * once -- used both by first-time setup and by "regenerate backup codes",
 * so the copy/download affordances only need to exist in one place. */
function BackupCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be blocked (permissions, insecure context) --
      // the codes are still fully visible and selectable on screen, so
      // this is a nice-to-have, not the only way to save them.
    }
  }

  function handleDownload() {
    const blob = new Blob(
      [`${PRODUCT_NAME}: two-factor backup codes\nEach code works once. Keep this somewhere safe.\n\n${codes.join("\n")}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${PRODUCT_SLUG}-backup-codes.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* saffron-900 on saffron-50: 9.3:1. */}
      <div className="flex items-start gap-3 rounded-2xl border border-saffron-200 bg-saffron-50 p-4">
        <AlertTriangle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-saffron-700" aria-hidden />
        <p className="text-[0.8125rem] font-medium leading-[1.55] text-saffron-900">
          Save these now &mdash; they are shown only once. Each code signs you in one time if you lose access to your
          authenticator app.
        </p>
      </div>

      {/* Numbered, so a code read aloud or ticked off on paper can be
          referred to ("I've used number 3"). The numbers are decoration --
          copy and download carry only the codes. */}
      <ol className="grid grid-cols-1 gap-2 rounded-2xl border border-line-strong bg-surface-muted p-4 font-mono text-[0.875rem] min-[420px]:grid-cols-2">
        {codes.map((code, index) => (
          <li key={code} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-content shadow-xs">
            <span aria-hidden className="w-5 text-right font-sans text-[0.6875rem] font-bold text-content-subtle tabular">
              {index + 1}
            </span>
            <span className="select-all tracking-wide">{code}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={handleCopy} leadingIcon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
          {copied ? "Copied" : "Copy Codes"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={handleDownload} leadingIcon={<Download className="h-4 w-4" />}>
          Download as File
        </Button>
      </div>

      <Button type="button" fullWidth onClick={onDone}>
        I&apos;ve Saved My Backup Codes
      </Button>
    </div>
  );
}

const SETUP_STEPS = ["Start", "Scan and confirm", "Save backup codes"];

/** Where you are in two-factor setup. Only three steps, but the middle one
 *  hands you off to a phone app and back, and the last one must not be
 *  skipped -- knowing there *is* a last step is the point. */
function SetupSteps({ current }: { current: number }) {
  return (
    <ol aria-label="Two-factor setup progress" className="flex items-center gap-2">
      {SETUP_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 items-center gap-2 last:flex-none [&:not(:last-child)]:flex-1"
          >
            {/* Discs: white on jade-500 3.4:1; white on brand-700 10.3:1;
                ink-600 on ink-100 6.3:1. */}
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold tabular",
                done && "bg-jade-500 text-white",
                active && "bg-brand-700 text-white shadow-brand",
                !done && !active && "bg-ink-100 text-ink-600",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn("truncate text-xs font-semibold", active ? "text-content" : "text-content-subtle")}>
              {step}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {index < SETUP_STEPS.length - 1 ? (
              <span aria-hidden className={cn("h-px min-w-4 flex-1", done ? "bg-jade-300" : "bg-line-strong")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function SecuritySettingsPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SecuritySettingsPageInner />
    </Suspense>
  );
}

/** useSearchParams() (used below for the ?setup=required deep link from the
 * mandatory-2FA redirect) opts a page out of static prerendering unless it's
 * wrapped in a Suspense boundary -- Next.js enforces this at build time, not
 * just as a runtime warning (see next.js.org/docs/messages/missing-suspense-
 * with-csr-bailout). The wrapper above is the fix; everything that actually
 * reads the search param and renders the page lives in here. */
function SecuritySettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupRequired = searchParams.get("setup") === "required";
  // A1 fix (30 Sep 2026 review): the forced-password-change deep link from
  // useProtectedPage's redirect (a brand-new admin who hasn't replaced
  // their random initial password yet).
  const passwordChangeRequired = searchParams.get("passwordChange") === "required";

  const session = useProtectedPage("ADMIN", { allowWithoutTwoFactor: true, allowWithoutPasswordChange: true });
  const { user, status } = session;
  const roleForShell = user?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  // Mirrors user.twoFactorEnabled locally so the UI updates the instant
  // setup/regenerate succeeds, without waiting on a full /auth/me re-fetch.
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  useEffect(() => {
    if (user) setTwoFactorEnabled(Boolean(user.twoFactorEnabled));
  }, [user]);

  // Same idea, for the A1 forced-password-change gate -- the Change
  // Password card below needs to be reachable even before 2FA is set up
  // when this is true (previously it only ever rendered once
  // twoFactorEnabled was true, which meant a brand-new admin sent here to
  // satisfy the password-change requirement had no way to actually see the
  // form).
  const [mustChangePassword, setMustChangePassword] = useState(false);
  // Card order is decided once, from the account as loaded, and then held:
  // if it followed mustChangePassword live, a successful change would fling
  // the card (and its "Password updated" confirmation) to the bottom of the
  // page at the exact moment the user is reading it.
  const [passwordFirst, setPasswordFirst] = useState(false);
  useEffect(() => {
    if (user) {
      setMustChangePassword(Boolean(user.mustChangePassword));
      // Only ever switched on: if the account is re-read after the change
      // (mustChangePassword now false), the card must not jump.
      setPasswordFirst((first) => first || Boolean(user.mustChangePassword));
    }
  }, [user]);

  // --- 2FA setup flow ---
  const [setupStage, setSetupStage] = useState<SetupStage>("idle");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [manualSecret, setManualSecret] = useState<string | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [startingSetup, setStartingSetup] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  async function beginSetup() {
    setSetupError(null);
    setStartingSetup(true);
    try {
      const { data } = await api.post<{ secret: string; qrCodeDataUrl: string; otpauthUri: string }>("/auth/2fa/setup");
      setQrCodeDataUrl(data.qrCodeDataUrl);
      setManualSecret(data.secret);
      setEnableCode("");
      setSetupStage("scan");
    } catch (err) {
      setSetupError(errorMessage(err, "start two-factor setup"));
    } finally {
      setStartingSetup(false);
    }
  }

  // The six digits submit themselves (CodeInput's onComplete) and the
  // button submits them too. A ref as well as the state, because a fast
  // typist's Enter can arrive before the re-render that disables the button.
  const enablingRef = useRef(false);
  const enableCodeRef = useRef<CodeInputHandle>(null);
  // The boxes are disabled while a code is being checked, and a disabled
  // input cannot take focus -- so the cursor is put back by an effect that
  // runs once `enabling` has gone false, not from the request's own catch
  // (which can run a frame too early). Same arrangement as the sign-in page.
  const refocusEnableCode = useRef(false);
  useEffect(() => {
    if (enabling || !refocusEnableCode.current) return;
    refocusEnableCode.current = false;
    enableCodeRef.current?.focus();
  }, [enabling]);
  // Arriving at the scan step: the cursor goes to the boxes, where the old
  // text field had autoFocus.
  useEffect(() => {
    if (setupStage === "scan") enableCodeRef.current?.focus();
  }, [setupStage]);

  async function enableTwoFactor(code: string) {
    if (enablingRef.current) return;
    if (code.length < 6) {
      setSetupError("Enter all six digits of the code your app is showing.");
      enableCodeRef.current?.focus();
      return;
    }
    enablingRef.current = true;
    setSetupError(null);
    setEnabling(true);
    try {
      const { data } = await api.post<{ backupCodes: string[] }>("/auth/2fa/enable", { code });
      setBackupCodes(data.backupCodes);
      setSetupStage("codes");
    } catch (err) {
      setSetupError(errorMessage(err, "turn on two-factor authentication"));
      // A refused code is finished with: the boxes empty for the next one
      // the app shows, and the cursor is already in them.
      setEnableCode("");
      refocusEnableCode.current = true;
    } finally {
      enablingRef.current = false;
      setEnabling(false);
    }
  }

  function finishSetup() {
    setTwoFactorEnabled(true);
    setSetupStage("idle");
    setQrCodeDataUrl(null);
    setManualSecret(null);
    setBackupCodes([]);
    // `user` is the account as it was when the page loaded. If the password
    // was replaced on this page a moment ago, that copy still says it must
    // be changed, so the flag is taken from what the page knows now.
    if (user) updateStoredUser({ ...user, mustChangePassword, twoFactorEnabled: true });
    if (setupRequired) router.replace("/admin/security");
  }

  // --- Regenerate backup codes ---
  const [regenerating, setRegenerating] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function handleRegenerate(event: React.FormEvent) {
    event.preventDefault();
    setRegenError(null);
    setRegenerating(true);
    try {
      const { data } = await api.post<{ backupCodes: string[] }>("/auth/2fa/backup-codes/regenerate", {
        password: regenPassword,
      });
      setRegenCodes(data.backupCodes);
      setRegenPassword("");
    } catch (err) {
      setRegenError(errorMessage(err, "create new backup codes"));
    } finally {
      setRegenerating(false);
    }
  }

  // --- Sessions & devices ---
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const { data } = await api.get<{ sessions: SessionSummary[] }>("/auth/sessions");
      setSessions(data.sessions);
      setSessionsLoaded(true);
    } catch (err) {
      // Older tokens issued before this feature shipped carry no "sid"
      // claim -- the endpoint still works, but if it ever errors this just
      // hides the list rather than blocking the rest of the page.
      setSessionsError(errorMessage(err, "load your signed-in devices"));
    } finally {
      setSessionsLoading(false);
    }
  }

  // Not while the password is still the issued one: the server answers
  // nothing but the password change until then (dependencies.py), so the
  // list would only fail -- and it must be read again the moment the gate
  // lifts, which is why both flags are watched.
  useEffect(() => {
    if (twoFactorEnabled && !mustChangePassword) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoFactorEnabled, mustChangePassword]);

  async function handleRevokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      const revokedCurrentDevice = sessions.find((s) => s.id === sessionId)?.isCurrent;
      if (revokedCurrentDevice) {
        clearSession();
        rememberSignedOut({ message: "You've signed out on this device. Sign in again to continue." });
        router.push("/login");
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setSessionsError(errorMessage(err, "sign that device out"));
    } finally {
      setRevokingSessionId(null);
    }
  }

  // If the request does not reach the server, nothing has been signed out
  // -- and "Sign Out of All Devices" is what someone presses when they
  // think an account is in the wrong hands. Until 3 Oct 2026 a failure here
  // still sent them to the sign-in page as though it had worked. Now they
  // stay and are told so -- "every device is still signed in" when the
  // server refused, "treat every device as still signed in" when no answer
  // came back and the outcome is not known.
  //
  // If the answer is that THIS session had already ended, nothing was
  // signed out either (the request was never accepted). lib/api.ts is by
  // then taking the tab to the sign-in page with the server's reason, and
  // brings them back here afterwards to press it again; this must not
  // replace that reason with a claim that every device was signed out.
  async function handleSignOutEverywhere() {
    setSigningOutEverywhere(true);
    setSessionsError(null);
    try {
      await api.post("/auth/logout-all-sessions");
    } catch (err) {
      const problem = describeApiError(err, "sign out your devices");
      if (problem.kind === "session") return;
      setSessionsError(
        `${problem.message} ${
          wasRefused(problem)
            ? "Every device is still signed in."
            : "Until this works, treat every device as still signed in."
        }`,
      );
      setSigningOutEverywhere(false);
      setConfirmSignOutAll(false);
      return;
    }
    clearSession();
    rememberSignedOut({ message: "You've signed out on every device. Sign in again to continue." });
    router.push("/login");
  }

  // --- Download my data ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportData() {
    setExportError(null);
    setExporting(true);
    try {
      const { data } = await api.get("/auth/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${PRODUCT_SLUG}-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(errorMessage(err, "prepare your data download"));
    } finally {
      setExporting(false);
    }
  }

  // --- Change password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // "signing-out": changed, and this browser is about to be signed out with
  // every other (a password someone chose to change). "kept": changed, and
  // this browser stays signed in (the first change of an issued password).
  const [passwordSaved, setPasswordSaved] = useState<"signing-out" | "kept" | null>(null);
  // The rules are shown neutrally until a save has been tried; after that,
  // the ones still unmet are marked as what is holding things up.
  const [passwordAttempted, setPasswordAttempted] = useState(false);
  const passwordSavedRef = useRef<HTMLDivElement>(null);
  // When the form is replaced by the "saved" note, the button that had the
  // focus no longer exists. The note takes it, so a keyboard user is not
  // dropped at the top of the page and the next Tab goes on to the next
  // step below.
  useEffect(() => {
    if (passwordSaved === "kept") passwordSavedRef.current?.focus();
  }, [passwordSaved]);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (changingPassword || passwordSaved) return;
    setPasswordError(null);
    setPasswordAttempted(true);

    // Checked here first, in the order the boxes are in, so nobody presses
    // the button to learn their password was a character short. The server
    // checks all of it again (core/security.py, strong_password_issue).
    if (!currentPassword) {
      setPasswordError(
        mustChangePassword
          ? "Enter the temporary password you signed in with, so we know it's you."
          : "Enter your current password, so we know it's you.",
      );
      currentPasswordRef.current?.focus();
      return;
    }
    const problem = passwordProblem(newPassword, {
      current: currentPassword,
      replacing: mustChangePassword ? "given" : "current",
    });
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

    // Replacing an issued password is the first thing a new admin does, and
    // two-factor setup is the second. Until 3 Oct 2026 the first signed them
    // out, so the sequence was: sign in, choose a password, get signed out,
    // sign in again, set up two-factor. `keepSignedIn` (the same request a
    // teacher's and a student's first change makes) keeps this one browser
    // signed in under the new password and ends every other session. A
    // password someone CHOOSES to change still signs out everywhere: that
    // is what a person who fears it is known needs to see happen.
    const firstChange = mustChangePassword;
    setChangingPassword(true);
    let saved: { updated: boolean; staySignedIn?: boolean; user?: CurrentUser } | null = null;
    try {
      const { data } = await api.post<{ updated: boolean; staySignedIn?: boolean; user?: CurrentUser }>(
        "/auth/change-password",
        { currentPassword, newPassword, keepSignedIn: firstChange },
      );
      saved = data;
    } catch (err) {
      const refused = describeApiError(err, "change your password");
      // lib/api.ts is already taking the tab to sign-in with the reason.
      if (refused.kind === "session") return;
      if (refused.code === "INVALID_PASSWORD") {
        setPasswordError(
          firstChange
            ? "The temporary password isn't right. It is the one you signed in with just now."
            : "Your current password isn't right. Check it and try again.",
        );
        currentPasswordRef.current?.focus();
      } else {
        setPasswordError(refused.message);
      }
      return;
    } finally {
      setChangingPassword(false);
    }

    // From here on the password IS saved, whatever happens next.
    setMustChangePassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordAttempted(false);

    if (saved.staySignedIn && saved.user) {
      setPasswordSaved("kept");
      updateStoredUser(saved.user);
      // The address said ?passwordChange=required; it no longer is. If
      // two-factor is still to be set up, say that instead, so a reload
      // lands on the right banner.
      router.replace(saved.user.twoFactorEnabled ? "/admin/security" : "/admin/security?setup=required");
      return;
    }

    // Signed out everywhere, this browser included: the token that made the
    // request stopped working when the password changed
    // (backend/app/dependencies.py). Said first, then done, so the next
    // click is not a refused request somewhere else.
    setPasswordSaved("signing-out");
    window.setTimeout(() => {
      clearSession();
      rememberSignedOut({ message: "Your password has been changed. Sign in with your new password." });
      router.push("/login");
    }, 1800);
  }

  if (status !== "ready" || !user) {
    return <SessionGate session={session} />;
  }

  // Current device first: "is this me?" is the first thing anyone checks
  // on a sessions list, and it's the row they're least likely to end.
  const orderedSessions = [...sessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  const otherSessionCount = sessions.filter((s) => !s.isCurrent).length;
  const setupStepIndex = setupStage === "idle" ? 0 : setupStage === "scan" ? 1 : 2;

  // A1 fix: previously gated on twoFactorEnabled alone, which meant a
  // brand-new admin sent here specifically to change their default
  // password (mustChangePassword) couldn't see this form at all -- it
  // wouldn't render until AFTER they'd already changed it.
  const showPasswordCard = twoFactorEnabled || mustChangePassword || passwordSaved !== null;
  const isSuperAdmin = roleForShell === "SUPER_ADMIN";
  const passwordRuleChecks = passwordChecks(newPassword, {
    current: currentPassword || null,
    replacing: mustChangePassword ? "given" : "current",
  });
  // Said as soon as it is certain: once as many characters are in the last
  // box as the new password holds, a difference is a mistake, not typing.
  const passwordMismatch =
    confirmPassword.length > 0 &&
    confirmPassword !== newPassword &&
    (passwordAttempted || confirmPassword.length >= newPassword.length);
  const passwordCard = showPasswordCard ? (
    <Card className={cn("animate-fade-up", passwordFirst ? "" : "delay-140")}>
      <CardBody className="space-y-5">
        <div className="flex items-center gap-3">
          <CardIcon tone={mustChangePassword ? "accent" : passwordSaved === "kept" ? "jade" : "coral"}>
            <KeyRound className="h-5 w-5" aria-hidden />
          </CardIcon>
          <div>
            <CardTitle>
              {mustChangePassword ? "Choose Your Own Password" : passwordSaved === "kept" ? "Password" : "Change Password"}
            </CardTitle>
            <CardDescription className="mt-0.5">
              {mustChangePassword
                ? "Replace the temporary password this account was issued with. You stay signed in here."
                : passwordSaved === "kept"
                  ? "Your own, and known only to you."
                  : "Changing it signs you out on every device, this one included."}
            </CardDescription>
          </div>
        </div>

        {passwordSaved === "kept" ? (
          // The first change is done and this browser is still signed in.
          // Nothing more to fill in here: the next step is the card below.
          // jade-800 on jade-50: 7.4:1.
          <div
            ref={passwordSavedRef}
            tabIndex={-1}
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-jade-200 bg-jade-50 p-4 outline-none animate-scale-in focus-visible:shadow-focus"
          >
            <Check className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-700" aria-hidden />
            <p className="text-[0.875rem] font-medium leading-[1.55] text-jade-800">
              {twoFactorEnabled
                ? `Your new password is saved, and every other device signed in to this account has been signed out. You can carry on with ${PRODUCT_NAME}.`
                : "Your new password is saved. One step left: set up two-factor authentication, just below."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="max-w-md space-y-4" noValidate>
            {/* For password managers only, so the new password is saved
                against this account and not with no name attached.
                Off-screen rather than type="hidden": managers ignore
                hidden inputs. */}
            {user.email ? (
              <input type="text" name="username" autoComplete="username" value={user.email} readOnly tabIndex={-1} aria-hidden className="sr-only" />
            ) : null}
            <TextField
              ref={currentPasswordRef}
              id="currentPassword"
              name="currentPassword"
              label={mustChangePassword ? "Temporary Password" : "Current Password"}
              hint={mustChangePassword ? "The one you signed in with" : undefined}
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
            <div className="space-y-3">
              <TextField
                ref={newPasswordRef}
                id="newPassword"
                name="newPassword"
                label="New Password"
                type="password"
                autoComplete="new-password"
                revealable
                required
                aria-describedby="newPasswordRules"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  // What the alert said was about what was typed before.
                  setPasswordError(null);
                }}
              />
              {/* Every rule the server will hold the password to, ticked off
                  as it is typed (lib/passwordRules.ts). This used to be a
                  hint reading "8+ characters, a letter and a number" and a
                  line about common passwords -- three of the rules, and the
                  rest left for the server to refuse after the button. */}
              <PasswordRulesList id="newPasswordRules" checks={passwordRuleChecks} attempted={passwordAttempted} />
            </div>
            <TextField
              ref={confirmPasswordRef}
              id="confirmPassword"
              name="confirmPassword"
              label="Type It Once More"
              type="password"
              autoComplete="new-password"
              revealable
              required
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setPasswordError(null);
              }}
              error={passwordMismatch ? "These two don't match yet." : null}
              hint={confirmPassword.length > 0 && confirmPassword === newPassword ? "They match" : undefined}
            />

            {passwordError ? <FormError>{passwordError}</FormError> : null}
            {passwordSaved === "signing-out" ? (
              // jade-700 on white: 7.3:1.
              <p role="status" className="flex items-start gap-2 text-[0.8125rem] font-medium text-jade-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Password changed. Signing you out so you can sign back in with it&hellip;
              </p>
            ) : null}

            <Button
              type="submit"
              loading={changingPassword}
              loadingLabel={mustChangePassword ? "Saving your password" : "Changing your password"}
              disabled={passwordSaved !== null}
            >
              {mustChangePassword ? "Save Password & Continue" : "Change Password"}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  ) : null;

  return (
    // The working level of the workspace wash: still, and a step down from
    // the dashboard's. This page is forms and a device list.
    <RoleShell role={roleForShell} user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Your Account"
          title="Security Settings"
          // Said to the person it is true of: a school admin's account
          // opens one school, a Super Admin's opens all of them.
          description={
            isSuperAdmin
              ? `This account reaches every school on ${PRODUCT_NAME}. Its password, its second sign-in step and the devices signed in as you are all here.`
              : "This account can see your whole school. Its password, its second sign-in step and the devices signed in as you are all here."
          }
          // The posture summary (3 Oct 2026). It was a card of three cells
          // under a header that was text on the canvas; it is the page's
          // own headline -- for a brand-new admin, the checklist of what is
          // left, in order -- so it moved up into the masthead with the
          // header, the way the Practice Tracker's tile row did. Each state
          // is said in words in the cell (value and hint); the tint only
          // repeats it (WCAG 1.4.1).
          stats={[
            {
              label: "Password",
              value: mustChangePassword ? "Temporary" : "Your Own",
              hint: mustChangePassword ? "Choose your own below to continue" : "No change needed",
              tone: mustChangePassword ? "attention" : "good",
            },
            {
              label: "Two-Factor",
              value: twoFactorEnabled ? "On" : "Off",
              hint: twoFactorEnabled
                ? "Authenticator app"
                : mustChangePassword
                  ? "Set up once your password is your own"
                  : "Required: set it up below",
              tone: twoFactorEnabled ? "good" : mustChangePassword ? "default" : "attention",
            },
            {
              label: "Signed-In Devices",
              // A count once there is one; a word while there cannot be.
              // "—" is kept for a count that failed to load.
              value: !twoFactorEnabled || mustChangePassword ? "Later" : sessionsLoaded ? sessions.length : sessionsError ? "—" : null,
              hint: mustChangePassword
                ? "Listed once your password is your own"
                : !twoFactorEnabled
                  ? "Listed once two-factor is on"
                  : sessionsLoaded
                  ? sessions.length === 1
                    ? "Only this one"
                    : "Including this one"
                  : sessionsError
                    ? "Couldn't be checked just now"
                    : undefined,
            },
          ]}
        />

        {passwordChangeRequired && mustChangePassword ? (
          <div role="status" className="flex items-start gap-3 rounded-3xl border border-saffron-200 bg-saffron-50 p-5 animate-scale-in">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-saffron-700" aria-hidden />
            <div>
              <p className="text-sm font-bold text-saffron-900">Change your password to continue</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-saffron-800">
                The password you signed in with is temporary: it was issued to you when this account was created or
                reset. Choose your own below before using the rest of {PRODUCT_NAME}.
              </p>
            </div>
          </div>
        ) : null}

        {setupRequired && !twoFactorEnabled && !mustChangePassword ? (
          <div role="status" className="flex items-start gap-3 rounded-3xl border border-saffron-200 bg-saffron-50 p-5 animate-scale-in">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-saffron-700" aria-hidden />
            <div>
              <p className="text-sm font-bold text-saffron-900">Set up two-factor authentication to continue</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-saffron-800">
                {isSuperAdmin
                  ? `A Super Admin account reaches every school, so ${PRODUCT_NAME} asks for a second sign-in step before it opens anything else.`
                  : `A school admin account opens your whole school's records, so ${PRODUCT_NAME} asks for a second sign-in step before it opens anything else.`}{" "}
                It takes about a minute with any authenticator app, such as Google Authenticator, Authy or 1Password.
              </p>
            </div>
          </div>
        ) : null}

        {passwordFirst ? passwordCard : null}

        {/* --- Two-factor authentication --- */}
        <Card className={cn("animate-fade-up", passwordFirst ? "delay-70" : "")}>
          <CardBody className="space-y-6">
            <div className="flex items-center gap-3">
              <CardIcon tone={twoFactorEnabled ? "jade" : "accent"}>
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </CardIcon>
              <div>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription className="mt-0.5">
                  {twoFactorEnabled
                    ? "Your account is protected by an authenticator app."
                    : isSuperAdmin
                      ? "Required for every Super Admin account."
                      : "Required for every school admin account."}
                </CardDescription>
              </div>
            </div>

            {twoFactorEnabled ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-muted p-4">
                  <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-content-subtle" aria-hidden />
                  <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                    {/* Who can help is different for each. A school admin
                        has someone to turn to. A Super Admin does not: there
                        is no screen that resets theirs (core/config.py, "its
                        2FA is reset at the DB level"), and saying "contact
                        your platform administrator" to the platform
                        administrator sent them looking for themselves. */}
                    {isSuperAdmin
                      ? "Two-factor authentication is required for every Super Admin account and can’t be turned off. If you lose both your authenticator app and your backup codes, this account can only be recovered on the server itself, so keep your backup codes somewhere safe."
                      : "Two-factor authentication is required for every school admin account and can’t be turned off. If you’ve lost both your authenticator app and your backup codes, contact your platform administrator."}
                  </p>
                </div>

                {!regenOpen && !regenCodes && !mustChangePassword ? (
                  <Button
                    type="button"
                    variant="secondary"
                    leadingIcon={<RefreshCw className="h-4 w-4" />}
                    onClick={() => setRegenOpen(true)}
                  >
                    Regenerate Backup Codes
                  </Button>
                ) : null}

                {regenOpen && !regenCodes ? (
                  <form onSubmit={handleRegenerate} className="max-w-md space-y-4 rounded-2xl border border-line p-4 animate-fade-in">
                    <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                      Generating new backup codes immediately invalidates any codes issued before. Confirm your
                      password to continue.
                    </p>
                    <TextField
                      id="regenPassword"
                      name="regenPassword"
                      label="Password"
                      type="password"
                      autoComplete="current-password"
                      required
                      autoFocus
                      value={regenPassword}
                      onChange={(event) => setRegenPassword(event.target.value)}
                      icon={<KeyRound className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                    />
                    {regenError ? <FormError>{regenError}</FormError> : null}
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" loading={regenerating} loadingLabel="Generating">
                        Generate New Codes
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setRegenOpen(false);
                          setRegenPassword("");
                          setRegenError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : null}

                {regenCodes ? (
                  <BackupCodesPanel
                    codes={regenCodes}
                    onDone={() => {
                      setRegenCodes(null);
                      setRegenOpen(false);
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="space-y-5">
                {setupStage === "idle" && mustChangePassword ? (
                  // A1 fix: the backend blocks /2fa/setup until the forced
                  // password change is done (dependencies.py checks that
                  // gate before the 2FA one), so showing the setup button
                  // here would just produce a confusing 403. The password
                  // card now sits above this one, so it says "above".
                  <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong p-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[0.6875rem] font-bold text-ink-600">
                      2
                    </span>
                    <p className="text-[0.875rem] leading-relaxed text-content-muted">
                      {passwordFirst ? "Choose your own password above first." : "Change your password below first."}{" "}
                      Two-factor setup opens as soon as it is saved.
                    </p>
                  </div>
                ) : null}

                {!mustChangePassword ? <SetupSteps current={setupStepIndex} /> : null}

                {setupStage === "idle" && !mustChangePassword ? (
                  <>
                    <p className="text-[0.875rem] leading-relaxed text-content-muted">
                      Scan a QR code with an authenticator app, confirm one code, and you&rsquo;re done. You&rsquo;ll
                      also get ten backup codes, each good for one sign-in, in case you ever lose your phone.
                    </p>
                    {setupError ? <FormError>{setupError}</FormError> : null}
                    <Button
                      type="button"
                      leadingIcon={<Smartphone className="h-4 w-4" />}
                      loading={startingSetup}
                      loadingLabel="Preparing setup"
                      onClick={beginSetup}
                    >
                      Set Up Two-Factor Authentication
                    </Button>
                  </>
                ) : null}

                {setupStage === "scan" ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void enableTwoFactor(enableCode);
                    }}
                    className="space-y-5 animate-fade-in"
                    noValidate
                  >
                    <div className="flex flex-col items-start gap-5 sm:flex-row">
                      {qrCodeDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- server-generated data URL, not an optimizable remote asset.
                        <img
                          src={qrCodeDataUrl}
                          alt="Scan this QR code with your authenticator app"
                          className="h-44 w-44 shrink-0 rounded-2xl border border-line bg-white p-2 shadow-card"
                        />
                      ) : null}
                      <div className="min-w-0 space-y-2">
                        <p className="text-[0.8125rem] font-semibold text-content">Can&rsquo;t scan it?</p>
                        <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                          Enter this key manually in your authenticator app instead:
                        </p>
                        <code className="block max-w-full select-all overflow-x-auto rounded-xl bg-surface-muted px-3 py-2 font-mono text-[0.8125rem] tracking-wide text-content">
                          {manualSecret}
                        </code>
                      </div>
                    </div>

                    {/* Six boxes, as at sign-in (3 Oct 2026): the same code,
                        read off the same app, was typed into an ordinary
                        text field here and into six boxes a day later. */}
                    <CodeInput
                      ref={enableCodeRef}
                      id="enableCode"
                      name="enableCode"
                      label="The 6-Digit Code Your App Shows"
                      value={enableCode}
                      onChange={(value) => {
                        setEnableCode(value);
                        if (setupError) setSetupError(null);
                      }}
                      onComplete={(code) => void enableTwoFactor(code)}
                      disabled={enabling}
                      invalid={Boolean(setupError)}
                      aria-describedby={setupError ? "enableCodeError" : undefined}
                      className="max-w-sm"
                    />

                    {setupError ? <FormError id="enableCodeError">{setupError}</FormError> : null}

                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" loading={enabling} loadingLabel="Confirming">
                        Confirm &amp; Enable
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setSetupStage("idle")}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : null}

                {setupStage === "codes" ? <BackupCodesPanel codes={backupCodes} onDone={finishSetup} /> : null}
              </div>
            )}
          </CardBody>
        </Card>

        {/* --- Signed-in devices --- (not while the password gate is up:
            the server would refuse the list, and every button on it) */}
        {twoFactorEnabled && !mustChangePassword ? (
          <Card className="animate-fade-up delay-70">
            <CardBody className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CardIcon tone="brand">
                    <MonitorSmartphone className="h-5 w-5" aria-hidden />
                  </CardIcon>
                  <div>
                    <CardTitle>Signed-In Devices</CardTitle>
                    <CardDescription className="mt-0.5">
                      Where you&rsquo;re signed in now, and a way to sign any one of them out.
                    </CardDescription>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadSessions}
                  disabled={sessionsLoading}
                  aria-label="Refresh device list"
                  title="Refresh"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-content-subtle transition hover:bg-surface-muted hover:text-content disabled:cursor-progress"
                >
                  <RefreshCw className={cn("h-4 w-4", sessionsLoading && "animate-spin")} aria-hidden />
                </button>
              </div>

              {sessionsError ? <FormError>{sessionsError}</FormError> : null}

              {sessionsLoading && !sessionsLoaded ? (
                <div aria-busy="true" className="space-y-2">
                  <span className="sr-only" role="status">
                    Loading your signed-in devices
                  </span>
                  {[0, 1].map((i) => (
                    <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
                      <span className="h-11 w-11 shrink-0 animate-pulse rounded-2xl bg-ink-100" />
                      <span className="flex-1 space-y-2">
                        <span className="block h-3.5 w-40 animate-pulse rounded-full bg-ink-100" />
                        <span className="block h-3 w-28 animate-pulse rounded-full bg-ink-100" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : orderedSessions.length > 0 ? (
                <ul className="space-y-2">
                  {orderedSessions.map((session) => (
                    <li
                      key={session.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5",
                        session.isCurrent ? "border-jade-200 bg-jade-50/50" : "border-line bg-surface-muted",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <CardIcon tone={session.isCurrent ? "jade" : "brand"}>
                          {/iphone|android|mobile/i.test(session.userAgent || "") ? (
                            <Smartphone className="h-[1.05rem] w-[1.05rem]" aria-hidden />
                          ) : (
                            <Laptop className="h-[1.05rem] w-[1.05rem]" aria-hidden />
                          )}
                        </CardIcon>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="truncate text-[0.8125rem] font-semibold text-content">
                              {deviceLabel(session.userAgent)}
                            </p>
                            {session.isCurrent ? (
                              <Badge tone="success" dot>
                                This Device
                              </Badge>
                            ) : null}
                          </div>
                          {/* content-subtle on the muted row: 6.0:1. */}
                          <p className="mt-0.5 truncate text-[0.75rem] text-content-subtle">
                            {session.ipAddress || "IP address not recorded"} &middot;{" "}
                            {relativeTime(session.lastSeenAt) ? `Active ${relativeTime(session.lastSeenAt)}` : "Last active not recorded"}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={
                          session.isCurrent
                            ? "Sign out this device"
                            : `Sign out ${deviceLabel(session.userAgent)}`
                        }
                        leadingIcon={<X className="h-3.5 w-3.5" />}
                        loading={revokingSessionId === session.id}
                        loadingLabel="Signing out"
                        onClick={() => handleRevokeSession(session.id)}
                      >
                        Sign Out
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : sessionsLoaded ? (
                <p className="text-[0.8125rem] text-content-subtle">No signed-in devices are listed for this account.</p>
              ) : null}

              <div className="space-y-3 border-t border-line pt-5">
                {!confirmSignOutAll ? (
                  <>
                    {/* No max-w-prose (1 Oct 2026): the card already bounds
                        this, and the 68ch cap stopped it 230-570px short of
                        the card edge on desktop, a line longer than it needed
                        to be -- the problem PageHeader.tsx's description had. */}
                    <p className="text-[0.875rem] leading-relaxed text-content-muted text-pretty">
                      Signed in on a shared computer and forgot to sign out, or think someone else has access? Sign
                      out of every device at once, this one included. You&rsquo;ll sign in again afterwards.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      leadingIcon={<LogOut className="h-4 w-4" />}
                      onClick={() => setConfirmSignOutAll(true)}
                    >
                      Sign Out of All Devices&hellip;
                    </Button>
                  </>
                ) : (
                  // coral-800 on coral-50: 8.7:1. The danger-filled button
                  // appears only here, at the point of no return.
                  <div role="group" aria-label="Confirm signing out of all devices" className="space-y-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
                    <p className="text-[0.8125rem] leading-relaxed text-coral-800">
                      <strong className="font-semibold">
                        Sign out of {otherSessionCount > 0 ? `all ${sessions.length} devices` : "every device"}, including
                        this one?
                      </strong>{" "}
                      You&rsquo;ll be taken to the sign-in page straight away, and so will anyone else signed in to this
                      account.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="danger"
                        leadingIcon={<LogOut className="h-4 w-4" />}
                        loading={signingOutEverywhere}
                        loadingLabel="Signing out everywhere"
                        onClick={handleSignOutEverywhere}
                      >
                        Sign Out Everywhere
                      </Button>
                      <Button type="button" variant="ghost" disabled={signingOutEverywhere} onClick={() => setConfirmSignOutAll(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {/* --- Your data --- */}
        {twoFactorEnabled && !mustChangePassword ? (
          <Card className="animate-fade-up delay-105">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="accent">
                  <FileJson className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Your Data</CardTitle>
                  <CardDescription className="mt-0.5">
                    Download a copy of your account details and recent activity.
                  </CardDescription>
                </div>
              </div>
              {/* Uncapped, as the sign-out-everywhere note above: it fits on
                  one line at desktop widths instead of breaking at 68ch. */}
              <p className="text-[0.875rem] leading-relaxed text-content-muted text-pretty">
                It includes your account and profile details, your recent sign-ins, and your recent account
                activity, as one file you can keep for your own records.
              </p>
              {exportError ? <FormError>{exportError}</FormError> : null}
              <Button
                type="button"
                variant="secondary"
                leadingIcon={<Download className="h-4 w-4" />}
                loading={exporting}
                loadingLabel="Preparing your data"
                onClick={handleExportData}
              >
                Download My Data
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {/* --- Change password (normal position) --- */}
        {!passwordFirst ? passwordCard : null}
      </div>
    </RoleShell>
  );
}
