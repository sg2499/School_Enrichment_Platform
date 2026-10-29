/** Wording for the Super Admin's Schools pages (#211). Pure, so it is unit tested. */
import type { AdminCredentials, SchoolCounts, SchoolRow } from "@/types/schools";

export function schoolPlace(school: Pick<SchoolRow, "city" | "state">): string {
  return [school.city, school.state].filter(Boolean).join(", ");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 admin · 14 teachers · 420 students · 12 sections" */
export function countsLine(counts: SchoolCounts): string {
  return [
    plural(counts.admins, "admin"),
    plural(counts.teachers, "teacher"),
    plural(counts.students, "student"),
    plural(counts.sections, "section"),
  ].join(" · ");
}

/** When someone at the school last used Krama, in words. */
export function lastActiveLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Not yet";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Not yet";
  const day = (d: Date) => Math.floor((d.getTime() + 5.5 * 3600_000) / 86_400_000); // IST calendar days
  const days = day(now) - day(then);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** Names compared as people read them: case and spacing aside (as the server does). */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}

export type SchoolFilter = "all" | "active" | "suspended";

/** The schools a search and a status filter leave, in the list's order. */
export function filterSchools(schools: SchoolRow[], query: string, status: SchoolFilter): SchoolRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return schools.filter((s) => {
    if (status === "active" && !s.isActive) return false;
    if (status === "suspended" && s.isActive) return false;
    const text = `${s.name} ${s.board ?? ""} ${s.city ?? ""} ${s.state ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** What a Super Admin hands a new admin, as text to copy. */
export function credentialsText(admin: AdminCredentials, schoolName: string, address: string): string {
  return [
    `${schoolName}: your Krama admin account`,
    `Sign in at: ${address}`,
    `Choose: Admin`,
    `Email: ${admin.email}`,
    `First password: ${admin.initialPassword}`,
    "You will choose your own password, and set up two-factor sign-in, the first time you sign in.",
  ].join("\n");
}
