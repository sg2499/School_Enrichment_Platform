/**
 * What the sign-in page says to each of the three kinds of people who use
 * it (3 Oct 2026, UI revamp Phase B, slice 3; moved here from the page on
 * 4 Oct 2026 so its lengths can be tested).
 *
 * Until slice 3 the page had one voice for everyone: a field labelled
 * "Email, Phone, or Code", and "Your school coordinator can reset it for
 * you" -- a person who does not exist in the product. Every line here is
 * written for the person choosing that way in, and says only what is true
 * for them:
 *
 *   - What they sign in with. Students and teachers are issued a code, and
 *     can use an email instead if the school entered one; admins always
 *     use an email.
 *   - Which password. Their own. A teacher or student replaces the one
 *     the school issued at their first sign-in, so "the password your
 *     school gave you" would be wrong on every visit but the first; the
 *     first-timer's line is the "New here?" one.
 *   - Who gives them a new password. A student tells their teacher, and the
 *     school admin issues it (People > Reset Password). A teacher goes to
 *     the school admin. A school admin goes to the platform administrator.
 *   - How long a session lasts. A student's ends within 10 hours whatever
 *     happens (backend/app/services/session_service.py), so they are told
 *     so. A teacher's has no such ceiling and an admin's is 12 hours;
 *     neither line makes a claim about it. What a teacher IS told is the
 *     thing that does end theirs: signing out revokes the session on the
 *     server.
 *   - Two-factor. Required of every admin, and asked for at every sign-in
 *     once it is set up -- a brand-new admin has not set it up yet, so the
 *     line does not say "always".
 *   - Who issues the account. A school issues its teachers' and students'
 *     accounts. It does not issue its own admin's: the platform
 *     administrator creates those (the first when the school joins, any
 *     others later), with the admin's email and a first password. The page used
 *     to answer this with the name of whichever school last signed in on
 *     the browser ("Accounts here are issued by MathPath"), which is the
 *     wrong answer for everyone from any other school -- the page is shared
 *     by all of them -- so it now says who, without naming anyone.
 *   - What the product does for them (`promise`). Only things that are
 *     live today, checked against the code: a teacher assigns published
 *     practice to a section and sees who has done it and each answer; a
 *     student attempts it and MOST of it is marked on submit (written
 *     answers wait for the teacher, which is why it says "most"); a school
 *     admin creates teachers' and students' accounts (not other admins')
 *     and maps chapters into the school's calendar.
 *   - Who "Admin" speaks to. School admins. A Super Admin signs in on the
 *     same tab, and two of its lines are not about them (nobody resets a
 *     Super Admin's password from inside the product, and no school's
 *     joining created their account). They are the platform's own
 *     operators, a handful of people who know that; the tab is written for
 *     the hundreds who are not.
 *
 * Picking a way in also decides who may sign in through it: each takes
 * only its own kind of account, and right details on the wrong one are
 * refused with the right one named (lib/signInRole.ts). A Super Admin uses
 * "Admin".
 *
 * No runtime imports, so it is unit-tested directly
 * (scripts/run-unit-tests.mjs).
 */
import type { SignInRole } from "./signInRole";

export interface SignInCopy {
  /** The choice itself, in the "Who is signing in" control. */
  tab: string;
  /** Who the left-hand panel is talking to: "For students". */
  audience: string;
  /** What the product does for them, in one sentence. */
  promise: string;
  /** The instruction under the greeting. One line: see INTRO_MAX_LENGTH. */
  intro: string;
  label: string;
  placeholder: string;
  missingIdentifier: string;
  safe: string;
  forgotten: string;
  /** Who issues this kind of account. */
  issuedBy: string;
  newHere: string;
}

/**
 * The longest an `intro` may be. The line sits under the greeting, and one
 * that wraps on one tab and not on the others makes the form jump as the
 * choice changes (the teacher's line did, at 60 characters, until 4 Oct
 * 2026). 46 characters fit the card on one line at every laptop size and
 * on phones from 380px wide; narrower than that the longest may wrap. The
 * unit test (tests/unit/signInCopy.test.mjs) holds the length; the browser
 * suite measures the lines.
 */
export const INTRO_MAX_LENGTH = 46;

export const SIGN_IN_COPY: Record<SignInRole, SignInCopy> = {
  STUDENT: {
    tab: "Student",
    audience: "For students",
    promise: "Practice set by your teacher, chapter by chapter, and most of it marked the moment you submit.",
    intro: "Use your student code and password.",
    label: "Student Code or Email",
    placeholder: "STU-ABCD-0042",
    missingIdentifier: "Enter your student code. It starts with STU-.",
    safe: "On a shared computer? Sign out when you finish. A session left open ends on its own within 10 hours.",
    forgotten: "Forgotten your password? Tell your teacher. Your school admin will give you a new one.",
    issuedBy: "Your school issues your account.",
    newHere: "New here? Ask your teacher for your student code and first password.",
  },
  TEACHER: {
    tab: "Teacher",
    audience: "For teachers",
    promise: "Set practice for a whole section in seconds, see who has done it, and review every answer.",
    intro: "Use your teacher code or email, and password.",
    label: "Teacher Code or Email",
    placeholder: "TCH-ABCD-0007 or you@school.in",
    missingIdentifier: "Enter your teacher code or your email address.",
    safe: "On a shared staffroom computer? Sign out when you finish: that ends your session on our servers.",
    forgotten: "Forgotten your password? Your school admin can give you a temporary one.",
    issuedBy: "Your school issues your account.",
    newHere: "New here? Your school admin gives you your teacher code and first password.",
  },
  ADMIN: {
    tab: "Admin",
    audience: "For school admins",
    promise: "Issue your teachers’ and students’ accounts, and decide which chapter runs when, class by class.",
    intro: "Use your admin email and password.",
    label: "Admin Email",
    placeholder: "you@school.in",
    missingIdentifier: "Enter your admin email address.",
    safe: "Admin accounts require two-factor. Once set up, every sign-in asks for an authenticator-app code.",
    forgotten: "Forgotten your password? Your platform administrator can give you a temporary one.",
    issuedBy: "Your platform administrator issues admin accounts.",
    newHere: "New here? They set it up and give you your first password.",
  },
};
