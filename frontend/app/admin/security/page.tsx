"use client";

import { Suspense, useEffect, useState } from "react";
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
import { TextField } from "@/components/ui/Field";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { api, apiErrorMessage } from "@/lib/api";
import { clearSession, updateStoredUser } from "@/lib/auth";

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
 * client-hints-grade parse. Falls back to "Unknown device" for anything
 * that doesn't match (scripts, unusual clients). */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
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

function relativeTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return "Just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
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
      [`School Enrichment -- two-factor backup codes\nEach code works once. Keep this somewhere safe.\n\n${codes.join("\n")}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "school-enrichment-backup-codes.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-saffron-200 bg-saffron-50 p-4">
        <AlertTriangle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-saffron-700" aria-hidden />
        <p className="text-[0.8125rem] font-medium leading-[1.55] text-saffron-900">
          Save these now &mdash; they are shown only once. Each code signs you in one time if you lose access to your
          authenticator app.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line-strong bg-surface-muted p-4 font-mono text-[0.8125rem] sm:grid-cols-2">
        {codes.map((code) => (
          <span key={code} className="rounded-lg bg-surface px-3 py-2 text-content shadow-xs">
            {code}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={handleCopy} leadingIcon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={handleDownload} leadingIcon={<Download className="h-4 w-4" />}>
          Download as file
        </Button>
      </div>

      <Button type="button" fullWidth onClick={onDone}>
        I&apos;ve saved my backup codes
      </Button>
    </div>
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

  const { user, status } = useProtectedPage("ADMIN", { allowWithoutTwoFactor: true });
  const roleForShell = user?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  // Mirrors user.twoFactorEnabled locally so the UI updates the instant
  // setup/regenerate succeeds, without waiting on a full /auth/me re-fetch.
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  useEffect(() => {
    if (user) setTwoFactorEnabled(Boolean(user.twoFactorEnabled));
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
      setSetupError(apiErrorMessage(err));
    } finally {
      setStartingSetup(false);
    }
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault();
    setSetupError(null);
    setEnabling(true);
    try {
      const { data } = await api.post<{ backupCodes: string[] }>("/auth/2fa/enable", { code: enableCode });
      setBackupCodes(data.backupCodes);
      setSetupStage("codes");
    } catch (err) {
      setSetupError(apiErrorMessage(err));
    } finally {
      setEnabling(false);
    }
  }

  function finishSetup() {
    setTwoFactorEnabled(true);
    setSetupStage("idle");
    setQrCodeDataUrl(null);
    setManualSecret(null);
    setBackupCodes([]);
    if (user) updateStoredUser({ ...user, twoFactorEnabled: true });
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
      setRegenError(apiErrorMessage(err));
    } finally {
      setRegenerating(false);
    }
  }

  // --- Sessions & devices ---
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const { data } = await api.get<{ sessions: SessionSummary[] }>("/auth/sessions");
      setSessions(data.sessions);
    } catch (err) {
      // Older tokens issued before this feature shipped carry no "sid"
      // claim -- the endpoint still works, but if it ever errors this just
      // hides the list rather than blocking the rest of the page.
      setSessionsError(apiErrorMessage(err));
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    if (twoFactorEnabled) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoFactorEnabled]);

  async function handleRevokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      const revokedCurrentDevice = sessions.find((s) => s.id === sessionId)?.isCurrent;
      if (revokedCurrentDevice) {
        clearSession();
        router.push("/login");
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setSessionsError(apiErrorMessage(err));
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleSignOutEverywhere() {
    setSigningOutEverywhere(true);
    try {
      await api.post("/auth/logout-all-sessions");
    } finally {
      clearSession();
      router.push("/login");
    }
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
      link.download = `school-enrichment-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(apiErrorMessage(err));
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
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setPasswordSuccess(true);
      // A password change invalidates the token that issued the request
      // (see backend/app/dependencies.py's password_changed_at check) --
      // the current session is already effectively over, so this signs the
      // user out cleanly instead of letting the next click surface a
      // confusing 401 somewhere else.
      window.setTimeout(() => {
        clearSession();
        router.push("/login");
      }, 1800);
    } catch (err) {
      setPasswordError(apiErrorMessage(err));
    } finally {
      setChangingPassword(false);
    }
  }

  if (status !== "ready" || !user) {
    return <LoadingScreen />;
  }

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Account security"
          title="Security Settings"
          description="Two-factor authentication, active sessions, and your password -- all in one place."
          meta={
            twoFactorEnabled ? (
              <Badge tone="success" dot icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                Two-factor enabled
              </Badge>
            ) : (
              <Badge tone="warning" dot pulse icon={<ShieldAlert className="h-3.5 w-3.5" />}>
                Two-factor required
              </Badge>
            )
          }
        />

        {setupRequired && !twoFactorEnabled ? (
          <div className="flex items-start gap-3 rounded-3xl border border-saffron-200 bg-saffron-50 p-5 animate-scale-in">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-saffron-700" aria-hidden />
            <div>
              <p className="text-sm font-bold text-saffron-900">Set up two-factor authentication to continue</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-saffron-800">
                Admin and super admin accounts control whole-school or platform-wide data, so this platform requires a
                second sign-in factor before anything else is accessible. It takes about a minute with any
                authenticator app (Google Authenticator, Authy, 1Password, etc.).
              </p>
            </div>
          </div>
        ) : null}

        {/* --- Two-factor authentication --- */}
        <Card className="animate-fade-up">
          <CardBody className="space-y-6">
            <div className="flex items-center gap-3">
              <CardIcon tone={twoFactorEnabled ? "jade" : "accent"}>
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </CardIcon>
              <div>
                <CardTitle>Two-factor authentication</CardTitle>
                <CardDescription className="mt-0.5">
                  {twoFactorEnabled
                    ? "Your account is protected by an authenticator app."
                    : "Required for admin and super admin accounts."}
                </CardDescription>
              </div>
            </div>

            {twoFactorEnabled ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-muted p-4">
                  <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-content-subtle" aria-hidden />
                  <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                    Two-factor authentication is mandatory for this role and can&rsquo;t be turned off from here. If
                    you&rsquo;ve lost your authenticator app and your backup codes, contact your platform
                    administrator.
                  </p>
                </div>

                {!regenOpen && !regenCodes ? (
                  <Button
                    type="button"
                    variant="secondary"
                    leadingIcon={<RefreshCw className="h-4 w-4" />}
                    onClick={() => setRegenOpen(true)}
                  >
                    Regenerate backup codes
                  </Button>
                ) : null}

                {regenOpen && !regenCodes ? (
                  <form onSubmit={handleRegenerate} className="space-y-4 rounded-2xl border border-line p-4">
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
                      value={regenPassword}
                      onChange={(event) => setRegenPassword(event.target.value)}
                      icon={<KeyRound className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                    />
                    {regenError ? (
                      <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {regenError}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" loading={regenerating} loadingLabel="Generating">
                        Generate new codes
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setRegenOpen(false)}>
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
                {setupStage === "idle" ? (
                  <>
                    <p className="text-[0.875rem] leading-relaxed text-content-muted">
                      Scan a QR code with an authenticator app, confirm one code, and you&rsquo;re done. You&rsquo;ll
                      also get ten one-time backup codes in case you ever lose your device.
                    </p>
                    {setupError ? (
                      <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {setupError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      leadingIcon={<Smartphone className="h-4 w-4" />}
                      loading={startingSetup}
                      loadingLabel="Preparing setup"
                      onClick={beginSetup}
                    >
                      Set up two-factor authentication
                    </Button>
                  </>
                ) : null}

                {setupStage === "scan" ? (
                  <form onSubmit={confirmSetup} className="space-y-5">
                    <div className="flex flex-col items-start gap-5 sm:flex-row">
                      {qrCodeDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- server-generated data URL, not an optimizable remote asset.
                        <img
                          src={qrCodeDataUrl}
                          alt="Scan this QR code with your authenticator app"
                          className="h-40 w-40 shrink-0 rounded-2xl border border-line bg-white p-2"
                        />
                      ) : null}
                      <div className="min-w-0 space-y-2">
                        <p className="text-[0.8125rem] font-semibold text-content">Can&rsquo;t scan it?</p>
                        <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                          Enter this key manually in your authenticator app instead:
                        </p>
                        <code className="block max-w-full overflow-x-auto rounded-xl bg-surface-muted px-3 py-2 text-[0.8125rem] font-mono text-content">
                          {manualSecret}
                        </code>
                      </div>
                    </div>

                    <TextField
                      id="enableCode"
                      name="enableCode"
                      label="Enter the 6-digit code from your app"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      required
                      autoFocus
                      value={enableCode}
                      onChange={(event) => setEnableCode(event.target.value)}
                      icon={<ShieldCheck className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                    />

                    {setupError ? (
                      <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {setupError}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" loading={enabling} loadingLabel="Confirming">
                        Confirm &amp; enable
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

        {/* --- Sessions & devices --- */}
        {twoFactorEnabled ? (
          <Card className="animate-fade-up delay-70">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <LogOut className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Sessions &amp; devices</CardTitle>
                  <CardDescription className="mt-0.5">
                    Where you&rsquo;re currently signed in, and a way to end any one of them.
                  </CardDescription>
                </div>
              </div>

              {sessionsError ? (
                <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {sessionsError}
                </p>
              ) : null}

              {sessionsLoading ? (
                <p className="text-[0.8125rem] text-content-subtle">Loading active sessions&hellip;</p>
              ) : sessions.length > 0 ? (
                <ul className="space-y-2">
                  {sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-muted p-3.5"
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
                          <p className="truncate text-[0.8125rem] font-semibold text-content">
                            {deviceLabel(session.userAgent)}
                            {session.isCurrent ? (
                              <Badge tone="success" className="ml-2 align-middle">
                                This device
                              </Badge>
                            ) : null}
                          </p>
                          <p className="mt-0.5 truncate text-[0.75rem] text-content-subtle">
                            {session.ipAddress || "Unknown IP"} &middot; Active {relativeTime(session.lastSeenAt)}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={session.isCurrent ? "Sign out this device" : "Sign out this session"}
                        leadingIcon={<X className="h-3.5 w-3.5" />}
                        loading={revokingSessionId === session.id}
                        loadingLabel="Ending"
                        onClick={() => handleRevokeSession(session.id)}
                      >
                        {session.isCurrent ? "Sign out" : "End session"}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.8125rem] text-content-subtle">No active sessions found.</p>
              )}

              <div className="border-t border-line pt-5">
                <p className="mb-3 text-[0.875rem] leading-relaxed text-content-muted">
                  If you signed in on a shared or public computer and forgot to sign out, or you suspect someone else
                  has access to your account, end every active session at once instead &mdash; including this one.
                  You&rsquo;ll need to log in again afterwards.
                </p>
                <Button
                  type="button"
                  variant="danger"
                  leadingIcon={<LogOut className="h-4 w-4" />}
                  loading={signingOutEverywhere}
                  loadingLabel="Signing out everywhere"
                  onClick={handleSignOutEverywhere}
                >
                  Sign out of all devices
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {/* --- Your data --- */}
        {twoFactorEnabled ? (
          <Card className="animate-fade-up delay-105">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="accent">
                  <FileJson className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Your data</CardTitle>
                  <CardDescription className="mt-0.5">
                    Download a copy of everything this platform holds about your account.
                  </CardDescription>
                </div>
              </div>
              <p className="text-[0.875rem] leading-relaxed text-content-muted">
                This includes your account and profile details, your recent login sessions, and your
                recent account activity, as a JSON file you can keep for your own records.
              </p>
              {exportError ? (
                <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {exportError}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                leadingIcon={<Download className="h-4 w-4" />}
                loading={exporting}
                loadingLabel="Preparing your data"
                onClick={handleExportData}
              >
                Download my data
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {/* --- Change password --- */}
        {twoFactorEnabled ? (
          <Card className="animate-fade-up delay-140">
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="coral">
                  <KeyRound className="h-5 w-5" aria-hidden />
                </CardIcon>
                <CardTitle>Change password</CardTitle>
              </div>
              <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
                <TextField
                  id="currentPassword"
                  name="currentPassword"
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  revealable
                  required
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <TextField
                  id="newPassword"
                  name="newPassword"
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  revealable
                  required
                  hint="At least 8 characters, a letter and a number, and not a common password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <TextField
                  id="confirmPassword"
                  name="confirmPassword"
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  revealable
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />

                {passwordError ? (
                  <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {passwordError}
                  </p>
                ) : null}
                {passwordSuccess ? (
                  <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-jade-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Password updated. Signing you out so you can log back in with it&hellip;
                  </p>
                ) : null}

                <Button type="submit" loading={changingPassword} loadingLabel="Updating">
                  Update password
                </Button>
              </form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </RoleShell>
  );
}
