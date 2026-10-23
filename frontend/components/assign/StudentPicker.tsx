"use client";

/**
 * Choosing which students of a section get a practice set (#161, 23 Oct
 * 2026): the section's students, ticked one by one, with Select All and
 * Clear. The server checks again that every one is in the section.
 */
import { useMemo, useState } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";

export interface SectionStudent {
  id: string;
  studentCode: string;
  name: string | null;
}

export function StudentPicker({
  className,
  section,
  chosen,
  onChange,
}: {
  className: string;
  section: string;
  chosen: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const query = useApiQuery<{ students: SectionStudent[] }>(
    "/learning/section-students",
    { className, section },
    { action: "load this section's students" },
  );
  const [search, setSearch] = useState("");
  const students = query.problem ? null : (query.data?.students ?? null);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!students || !term) return students ?? [];
    return students.filter((s) => (s.name ?? "").toLowerCase().includes(term) || s.studentCode.toLowerCase().includes(term));
  }, [students, search]);

  if (query.problem) return <LoadError problem={query.problem} onRetry={query.reload} />;
  if (!students) return <p className="text-sm text-content-muted">Loading the section&apos;s students…</p>;
  if (students.length === 0) return <p className="text-sm text-content-muted">No students are in this section yet.</p>;

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold text-content" aria-live="polite">
          {chosen.size} of {students.length} chosen
        </p>
        <Button
          type="button"
          size="sm"
          variant="tinted"
          onClick={() => onChange(new Set([...chosen, ...shown.map((s) => s.id)]))}
        >
          {search.trim() ? "Select These" : "Select All"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={chosen.size === 0} onClick={() => onChange(new Set())}>
          Clear
        </Button>
      </div>
      {students.length > 8 ? (
        <SearchInput label="Find a student" placeholder="Name or code" value={search} onSearch={setSearch} delayMs={150} />
      ) : null}
      <ul className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2" aria-label="Students in this section">
        {shown.map((student) => (
          <li key={student.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-brand-600"
                checked={chosen.has(student.id)}
                onChange={() => toggle(student.id)}
              />
              <span className="min-w-0 text-sm text-content">
                {student.name ?? student.studentCode}
                <span className="block text-xs text-content-subtle">{student.studentCode}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
