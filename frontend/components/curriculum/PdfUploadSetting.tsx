"use client";

/**
 * Whether a written question asks the child for a PDF of their work (#237),
 * on a question's card in Curriculum Studio. Written (teacher-marked)
 * questions have no other marking settings, so this is the whole panel for
 * them. "Platform Decides" reads the wording; a reviewer can say Required,
 * Optional or None. Saved on its own, right away.
 */
import { useId, useState } from "react";
import { FileText } from "lucide-react";
import { SelectField } from "@/components/ui/Field";
import { api, describeApiError } from "@/lib/api";
import type { QuestionDetail } from "@/types/curriculum";

type Choice = "" | "REQUIRED" | "OPTIONAL" | "NONE";

const NOW: Record<string, string> = {
  REQUIRED: "A PDF of the child's work is required for full marks.",
  OPTIONAL: "The child may attach a PDF of their working.",
  NONE: "No PDF box on this question.",
};

export function PdfUploadSetting({ question, onSaved }: { question: QuestionDetail; onSaved: (next: QuestionDetail) => void }) {
  const headingId = useId();
  const [choice, setChoice] = useState<Choice>((question.uploadRule ?? "") as Choice);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(next: Choice) {
    setChoice(next);
    setSaving(true);
    setProblem(null);
    try {
      const response = await api.patch<QuestionDetail>(`/curriculum-admin/questions/${question.id}/marking`, {
        uploadRule: next === "" ? null : next,
      });
      onSaved(response.data);
    } catch (error) {
      setChoice((question.uploadRule ?? "") as Choice);
      setProblem(describeApiError(error, "save the PDF upload setting").message);
    } finally {
      setSaving(false);
    }
  }

  const effective = question.effectiveUploadRule ?? "NONE";
  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-xl border border-line bg-surface-muted px-3 py-2.5">
      <h4 id={headingId} className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
        <FileText aria-hidden className="h-3.5 w-3.5" />
        PDF Upload
      </h4>
      <p className="text-sm text-content-muted">
        {NOW[effective]}
        {choice === "" && question.uploadRuleReason ? ` (Platform decided: ${question.uploadRuleReason})` : ""}
      </p>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-coral-700">
          {problem}
        </p>
      ) : null}
      <SelectField label="PDF Upload" value={choice} disabled={saving} onChange={(event) => void change(event.target.value as Choice)}>
        <option value="">Platform Decides</option>
        <option value="REQUIRED">Required</option>
        <option value="OPTIONAL">Optional</option>
        <option value="NONE">None</option>
      </SelectField>
    </section>
  );
}
