"use client";

/**
 * Classes & Sections (#210, 29 Oct 2026; PHASE8_SCHOOL_SETUP_DESIGN.md), for
 * a school's admin: set the school up from one workbook (teachers with the
 * sections they teach, students with class, section and roll number),
 * checked whole and imported all or nothing; print the new accounts'
 * sign-in slips; see each section's students and teachers; and give a
 * section new slips for students who have not signed in yet.
 */
import { useRef, useState } from "react";
import { Download, FileCheck2, Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { errorDetail } from "@/lib/errors";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { checkSummary } from "@/lib/schoolSetup";
import { SignInSlips } from "@/components/school/SignInSlips";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { SectionSlips, SectionSummary, SectionsView, SetupCheck, SetupImport, SetupProblem } from "@/types/schoolSetup";

const sectionKey = (className: string | null, section: string | null) => `${className ?? ""}|${section ?? ""}`;

/** The rows the server listed when it refused an import, as a failed check. */
function refusedCheck(err: unknown): SetupCheck | null {
  const problems = errorDetail(err, "problems");
  if (!Array.isArray(problems) || problems.length === 0) return null;
  return {
    ok: false,
    problems: problems as SetupProblem[],
    newTeachers: 0,
    teachersAlreadyHere: 0,
    newStudents: 0,
    studentsAlreadyHere: 0,
    newSectionsTaught: 0,
    sections: [],
  };
}

function SetupCard({ onImported, reissued }: { onImported: () => void; reissued: string[] }) {
  const input = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<SetupCheck | null>(null);
  const [result, setResult] = useState<SetupImport | null>(null);
  const [busy, setBusy] = useState<"template" | "check" | "import" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function downloadTemplate() {
    setBusy("template");
    setProblem(null);
    try {
      const { data } = await api.get<Blob>("/roster/setup-template", { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Krama_School_Setup.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setProblem(errorMessage(err, "download the template"));
    } finally {
      setBusy(null);
    }
  }

  function form(chosen: File) {
    const data = new FormData();
    data.append("file", chosen);
    return data;
  }

  async function checkFile(chosen: File) {
    setFile(chosen);
    setCheck(null);
    setResult(null);
    setProblem(null);
    setBusy("check");
    try {
      const { data } = await api.post<SetupCheck>("/roster/setup/check", form(chosen));
      setCheck(data);
    } catch (err) {
      setProblem(errorMessage(err, "check this file"));
    } finally {
      setBusy(null);
      // So the same file, corrected and saved, can be chosen again.
      if (input.current) input.current.value = "";
    }
  }

  async function importFile() {
    if (!file || importing.current) return; // one press, one import
    importing.current = true;
    setBusy("import");
    setProblem(null);
    try {
      const { data } = await api.post<SetupImport>("/roster/setup/import", form(file));
      setResult(data);
      setCheck(null);
      setFile(null);
      onImported();
    } catch (err) {
      // Something changed since the check (a row Krama only checks on import, or another import): list the rows.
      const refused = refusedCheck(err);
      if (refused) setCheck(refused);
      else setProblem(errorMessage(err, "import this file"));
    } finally {
      importing.current = false;
      setBusy(null);
    }
  }

  // A section given New Slips since: its students' slips here no longer work.
  const current = result
    ? result.created.filter((s) => s.role !== "STUDENT" || !reissued.includes(sectionKey(s.className, s.section)))
    : [];
  const dropped = result ? result.created.length - current.length : 0;
  const canImport = check !== null && check.ok && check.newTeachers + check.newStudents + check.newSectionsTaught > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set Up the School</CardTitle>
        <CardDescription>
          One workbook for the whole school: teachers with the sections they teach, and students with their class, section and roll number.
          It is checked first, and nothing is created until every row is right.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-5">
        <ol className="grid gap-3 text-sm text-content-muted sm:grid-cols-3">
          <li className="rounded-2xl bg-surface-muted p-4">
            <p className="font-semibold text-content">1. Download the Template</p>
            <p className="mt-1">Fill in its Teachers and Students sheets.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              leadingIcon={<Download className="h-3.5 w-3.5" />}
              loading={busy === "template"}
              loadingLabel="Downloading"
              onClick={downloadTemplate}
            >
              Download Template
            </Button>
          </li>
          <li className="rounded-2xl bg-surface-muted p-4">
            <p className="font-semibold text-content">2. Upload It to Check</p>
            <p className="mt-1">Krama lists anything to fix, by sheet and row.</p>
            <input
              ref={input}
              id="setup-file"
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) void checkFile(chosen);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              leadingIcon={<Upload className="h-3.5 w-3.5" />}
              loading={busy === "check"}
              loadingLabel="Checking"
              onClick={() => input.current?.click()}
            >
              Choose Workbook
            </Button>
          </li>
          <li className="rounded-2xl bg-surface-muted p-4">
            <p className="font-semibold text-content">3. Import and Print Slips</p>
            <p className="mt-1">Each new person gets a code and first password, shown once.</p>
          </li>
        </ol>

        {problem ? <AlertBanner tone="error" message={problem} /> : null}

        {check && !check.ok ? (
          <div className="space-y-3" role="alert">
            <p className="text-sm font-semibold text-coral-800">
              {check.problems.length === 1 ? "1 row to fix" : `${check.problems.length} rows to fix`} in {file?.name}. Nothing has been
              created. Correct the workbook and choose it again.
            </p>
            <Table caption="Rows to fix" minWidth="32rem">
              <THead>
                <TH>Sheet</TH>
                <TH>Row</TH>
                <TH>What to Fix</TH>
              </THead>
              <TBody>
                {check.problems.map((p, i) => (
                  <TR key={`${p.sheet}-${p.row}-${i}`}>
                    <TD>{p.sheet}</TD>
                    <TD>{p.row}</TD>
                    <TD>{p.message}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}

        {check && check.ok ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4">
            <p className="flex items-start gap-2 text-sm text-content">
              <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" aria-hidden="true" />
              <span>
                {checkSummary(check)}
                {check.sections.length ? ` Sections: ${check.sections.join(", ")}.` : ""}
                {check.newTeachers ? " New teachers' emails and mobile numbers are checked when you import." : ""}
              </span>
            </p>
            {canImport ? (
              <Button type="button" loading={busy === "import"} loadingLabel="Importing" onClick={importFile}>
                Import
              </Button>
            ) : null}
          </div>
        ) : null}

        {result ? (
          current.length ? (
            <SignInSlips
              slips={current}
              schoolName={result.schoolName}
              title={`Imported: ${checkSummary(result).replace(/^Ready to import: /, "")}`}
              note={`Print the slips or download the sign-in details now. These passwords are shown only here; if a slip is lost, use New Slips on its section.${
                dropped
                  ? ` ${dropped === 1 ? "1 student's slip is" : `${dropped} students' slips are`} no longer listed here: their section has new slips below.`
                  : ""
              }`}
            />
          ) : result.created.length ? (
            <AlertBanner
              tone="success"
              message="Imported. The new students' slips are in Sections below, where their section was given new slips."
            />
          ) : (
            <AlertBanner
              tone="success"
              message={`Imported: ${result.newSectionsTaught === 1 ? "1 section was" : `${result.newSectionsTaught} sections were`} given to their teachers. No new accounts were needed.`}
            />
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function SectionsCard({
  view,
  onReload,
  onReissued,
}: {
  view: ReturnType<typeof useApiQuery<SectionsView>>;
  onReload: () => void;
  onReissued: (key: string) => void;
}) {
  const [asking, setAsking] = useState<SectionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [slips, setSlips] = useState<(SectionSlips & { label: string }) | null>(null);

  async function reissue(section: SectionSummary) {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<SectionSlips>("/roster/sections/slips", { className: section.className, section: section.section });
      setSlips({ ...data, label: `${section.className}${section.section}` });
      onReissued(sectionKey(section.className, section.section));
      setAsking(null);
      onReload();
    } catch (err) {
      setProblem(errorMessage(err, "make new slips"));
    } finally {
      setBusy(false);
    }
  }

  if (view.problem) return <LoadError problem={view.problem} onRetry={view.reload} />;
  if (!view.data) return <TableSkeleton label="Loading the sections" rows={4} />;
  const sections = view.data.sections;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sections</CardTitle>
        <CardDescription>
          Each section&apos;s students and who teaches it. Not Signed In counts students still on their first password.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {sections.length === 0 ? (
          <EmptyState
            title="No Sections Yet"
            description="Sections appear here once students are added, from the School Setup workbook above or on People."
          />
        ) : (
          <Table caption="Sections" minWidth="40rem">
            <THead>
              <TH>Section</TH>
              <TH align="right">Students</TH>
              <TH align="right">Not Signed In</TH>
              <TH>Teachers</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {sections.map((s) => (
                <TR key={`${s.className}-${s.section}`}>
                  <TD className="font-semibold text-content">
                    Class {s.className} · {s.section}
                  </TD>
                  <TD align="right">{s.students}</TD>
                  <TD align="right">{s.awaitingFirstSignIn}</TD>
                  <TD>
                    {s.teachers.length ? (
                      s.teachers.map((t) => `${t.fullName} (${t.subject})`).join(", ")
                    ) : (
                      <span className="text-content-subtle">No teacher yet</span>
                    )}
                  </TD>
                  <TD align="right">
                    {s.awaitingFirstSignIn > 0 ? (
                      <Button type="button" size="sm" variant="tinted" onClick={() => setAsking(s)}>
                        New Slips
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {problem ? <AlertBanner tone="error" message={problem} /> : null}
        {slips ? (
          <SignInSlips
            slips={slips.slips}
            schoolName={slips.schoolName}
            title={`New slips for ${slips.label}: ${slips.slips.length === 1 ? "1 student" : `${slips.slips.length} students`}`}
            note={`Their earlier slips no longer work. ${
              slips.alreadySignedIn
                ? `${slips.alreadySignedIn === 1 ? "1 student has" : `${slips.alreadySignedIn} students have`} already chosen their own password and kept it. `
                : ""
            }These passwords are shown only here.`}
          />
        ) : null}
      </CardBody>
      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
        size="sm"
        title={asking ? `New Slips for ${asking.className}${asking.section}?` : ""}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button type="button" loading={busy} loadingLabel="Making Slips" onClick={() => asking && void reissue(asking)}>
              Make New Slips
            </Button>
          </>
        }
      >
        {asking ? (
          <p className="text-sm text-content-muted">
            The {asking.awaitingFirstSignIn === 1 ? "student" : `${asking.awaitingFirstSignIn} students`} in Class {asking.className} ·{" "}
            {asking.section} who {asking.awaitingFirstSignIn === 1 ? "has" : "have"} not signed in yet will get a new first password, and
            their earlier slips will stop working. Students who have chosen their own password are not changed.
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}

export function ClassesAndSections() {
  const view = useApiQuery<SectionsView>("/roster/sections", {}, { action: "load the school's sections" });
  const [reissued, setReissued] = useState<string[]>([]);
  const sections = view.data?.sections ?? [];
  const students = sections.reduce((n, s) => n + s.students, 0);
  const waiting = sections.reduce((n, s) => n + s.awaitingFirstSignIn, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="School"
        title="Classes & Sections"
        description="Set up the school's teachers and students from one workbook, print their sign-in slips, and see who is in each section."
        stats={[
          { label: "Sections", value: view.problem ? "—" : view.data ? sections.length : null },
          { label: "Students", value: view.problem ? "—" : view.data ? students : null },
          {
            label: "Not Signed In",
            value: view.problem ? "—" : view.data ? waiting : null,
            tone: waiting ? "attention" : undefined,
            hint: "Still on their first password",
          },
        ]}
      />
      <SetupCard
        onImported={() => {
          setReissued([]);
          view.reload();
        }}
        reissued={reissued}
      />
      <SectionsCard view={view} onReload={view.reload} onReissued={(key) => setReissued((keys) => [...keys, key])} />
    </div>
  );
}
