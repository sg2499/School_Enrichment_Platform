"use client";

import { useId, useRef, useState } from "react";
import { AlertCircle, ArrowRight, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { passwordChecks, passwordProblem } from "@/lib/passwordRules";
import type { CurrentUser } from "@/types/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { PasswordRulesList } from "@/components/ui/PasswordRulesList";
import { TextField } from "@/components/ui/Field";

/** The two roles that choose a password here. Admins replace theirs on the
 *  security page, which also walks them into two-factor setup. */
export type ChoosePasswordRole = "TEACHER" | "STUDENT";

const COPY: Record<ChoosePasswordRole, { given: string; keep: string; opening: string }> = {
  STUDENT: {
    given: "Password Your School Gave You",
    keep: "Only you should know it. If you forget it, tell your teacher.",
    opening: "Opening your learning space",
  },
  TEACHER: {
    given: "Password Your School Admin Gave You",
    keep: "Only you should know it. If you forget it, your school admin can give you a temporary one.",
    opening: "Opening your teaching workspace",
  },
};

/** What the sign-in page says after the password is saved but this browser
 *  could not be kept signed in. Exported so both callers say the same thing. */
export const PASSWORD_SAVED_SIGN_IN_AGAIN = "Your new password is saved. Sign in with it to continue.";

interface ChangePasswordResponse {
  updated: boolean;
  staySignedIn?: boolean;
  user?: CurrentUser;
}

export interface ChoosePasswordProps {
  role: ChoosePasswordRole;
  /**
   * The password being replaced, when this screen already has it: on the
   * sign-in page it was typed a moment ago, and asking for it again would
   * only be a third chance to mistype a string nobody chose. Leave unset
   * and the form asks for it (the standalone page, reached with a session
   * but no memory of what was typed).
   */
  currentPassword?: string | null;
  /** What they sign in with (their code or email). Not shown; it is there
   *  so a password manager saves the new password against the right
   *  account rather than with no name attached. */
  username?: string | null;
  /** The password is saved and this browser is still signed in. */
  onDone: (user: CurrentUser) => void;
  /** The password is saved but the session was not kept; `message` says so
   *  in words for the sign-in page. */
  onSignedOut: (message: string) => void;
  /** The session ended before anything was saved (left too long on this
   *  step); `message` is the server's reason. Only the sign-in page needs
   *  it: inside a workspace, lib/api.ts already takes the tab to sign-in. */
  onSessionEnded?: (message: string) => void;
  /** Extra classes for the form (the sign-in page tightens the spacing on
   *  short laptop screens). */
  className?: string;
  /** True once the caller has taken over and is navigating away, so the
   *  button keeps saying something is happening until the page changes. */
  finishing?: boolean;
  /** How the caller dresses the one button, so that on the sign-in card the
   *  third step's button is the same button as the first two steps'. Left
   *  out, it is the product's standard button with a plain arrow. */
  submitClassName?: string;
  submitIcon?: React.ReactNode;
}

/**
 * "Choose your own password" (3 Oct 2026, UI revamp Phase B, slice 3).
 *
 * A teacher's or student's first password is issued by the school: read off
 * an admin's screen, copied into a sheet, handed over on paper. It gets them
 * in once. This is the step that makes the account theirs -- and the server
 * lets them do nothing else until it is done (backend/app/dependencies.py,
 * MUST_CHANGE_PASSWORD_ROLES).
 *
 * The rules are shown as a checklist that fills in while they type, from
 * lib/passwordRules.ts (the server's own rules, run early). A Class 5
 * student should never have to press a button to find out their password
 * was too short.
 *
 * Asks the server to keep this browser signed in (`keepSignedIn`), so the
 * sequence is "sign in, choose a password, start", not "sign in, choose a
 * password, get signed out, sign in again".
 */
export function ChoosePassword({
  role,
  currentPassword,
  username,
  onDone,
  onSignedOut,
  onSessionEnded,
  className,
  finishing = false,
  submitClassName,
  submitIcon,
}: ChoosePasswordProps) {
  const copy = COPY[role];
  const knowsCurrent = typeof currentPassword === "string" && currentPassword.length > 0;
  const rulesId = useId();
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const givenRef = useRef<HTMLInputElement>(null);

  const [given, setGiven] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rules are shown neutrally until the person has tried to submit; after
  // that, the ones still unmet are marked as what is holding things up.
  const [attempted, setAttempted] = useState(false);

  const current = knowsCurrent ? (currentPassword as string) : given;
  const checks = passwordChecks(password, { current: current || null });
  // Said as soon as it is certain: once as many characters have been typed
  // into the second box as the first holds, a difference is a mistake and
  // not just "still typing".
  const mismatch = confirm.length > 0 && confirm !== password && (attempted || confirm.length >= password.length);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || finishing) return;
    setError(null);
    setAttempted(true);

    if (!knowsCurrent && !given.trim()) {
      setError("Enter the password you were given, so we know it's you.");
      givenRef.current?.focus();
      return;
    }
    const problem = passwordProblem(password, { current: current || null });
    if (problem) {
      setError(problem);
      newRef.current?.focus();
      return;
    }
    if (confirm !== password) {
      setError(confirm ? "The two passwords don't match. Type your new password again in the second box." : "Type your new password once more in the second box.");
      confirmRef.current?.focus();
      return;
    }

    setSaving(true);
    let saved: ChangePasswordResponse | null = null;
    try {
      const { data } = await api.post<ChangePasswordResponse>(
        "/auth/change-password",
        { currentPassword: current, newPassword: password, keepSignedIn: true },
        // Said outright rather than left to the path: this form also runs on
        // the sign-in page, which belongs to no role, and the server picks
        // the session cookie to read from this header.
        { headers: { "X-Auth-Role": role } },
      );
      saved = data;
    } catch (err) {
      // The role is passed, not read from the address: on the sign-in page
      // the address belongs to nobody, and a student would be told to "give
      // your school this reference" instead of "your teacher".
      const problem = describeError(err, { action: "save your new password", role });
      if (problem.kind === "session" && onSessionEnded) {
        onSessionEnded(problem.message);
      } else if (problem.code === "INVALID_PASSWORD") {
        // The server's sentence calls it "your current password", which is
        // its name on the profile menu's form. Here the box it refers to is
        // labelled as the password they were given.
        setError("The password you were given isn't right. Check it and try again.");
        givenRef.current?.focus();
      } else {
        setError(problem.message);
      }
      return;
    } finally {
      setSaving(false);
    }

    // Outside the try, on purpose: from here on the password IS saved. If
    // the caller's own next step throws (storage that refuses a write,
    // say), that must not be reported as "couldn't save your password" --
    // a retry would then be told the password they were given is wrong.
    if (!saved) return;
    if (saved.staySignedIn && saved.user) {
      onDone(saved.user);
    } else {
      // Saved, but the session was not kept (a server that predates
      // keepSignedIn answers this way). Their new password works; they are
      // simply asked for it.
      onSignedOut(PASSWORD_SAVED_SIGN_IN_AGAIN);
    }
  }

  return (
    // `method`: script handles the submit, but a form with no method is a
    // GET, and a GET before the script has loaded would put both passwords
    // in the address bar.
    <form method="post" onSubmit={handleSubmit} className={cn("space-y-5", className)} noValidate>
      {/* For password managers only (see `username` above). Off-screen
          rather than type="hidden": managers ignore hidden inputs. */}
      {username ? (
        <input type="text" name="username" autoComplete="username" value={username} readOnly tabIndex={-1} aria-hidden className="sr-only" />
      ) : null}
      {knowsCurrent ? null : (
        <TextField
          ref={givenRef}
          id="choosePasswordGiven"
          name="currentPassword"
          label={copy.given}
          autoComplete="current-password"
          required
          revealable
          autoFocus
          value={given}
          onChange={(event) => {
            setGiven(event.target.value);
            setError(null);
          }}
          icon={<KeyRound className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
        />
      )}

      <div className="space-y-3">
        <TextField
          ref={newRef}
          id="choosePasswordNew"
          name="newPassword"
          label="Your New Password"
          autoComplete="new-password"
          required
          revealable
          autoFocus={knowsCurrent}
          aria-describedby={rulesId}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            // What the alert said was about what was typed before.
            setError(null);
          }}
          icon={<Lock className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
        />
        <PasswordRulesList id={rulesId} checks={checks} attempted={attempted} />
      </div>

      <TextField
        ref={confirmRef}
        id="choosePasswordConfirm"
        name="confirmPassword"
        label="Type It Once More"
        autoComplete="new-password"
        required
        revealable
        value={confirm}
        onChange={(event) => {
          setConfirm(event.target.value);
          setError(null);
        }}
        error={mismatch ? "These two don't match yet." : null}
        hint={confirm.length > 0 && confirm === password ? "They match" : undefined}
        icon={<ShieldCheck className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
      />

      {error ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
          <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
          <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={saving || finishing}
        loadingLabel={finishing ? copy.opening : "Saving your password"}
        trailingIcon={submitIcon ?? <ArrowRight className="h-4 w-4" />}
        className={submitClassName}
      >
        Save Password &amp; Continue
      </Button>

      <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.5] text-content-muted">
        <ShieldCheck className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
        <span>{copy.keep}</span>
      </p>
    </form>
  );
}
