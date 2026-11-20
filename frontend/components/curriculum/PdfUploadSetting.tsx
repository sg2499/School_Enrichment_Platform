"use client";

/**
 * Whether a written question asks the child for a PDF of their work (#237),
 * on a question's card in Curriculum Studio. Written (teacher-marked)
 * questions have no other marking settings, so this is the whole panel for
 * them. "Platform Decides" reads the wording; a reviewer can say Required,
 * Optional or None. Saved on its own, right away.
 *
 * What it does today sits on the left and the one control on the right, so
 * the panel reads as a sentence and its answer (20 Nov 2026).
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
    <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface-muted">
      <div className="flex items-center gap-3 px-4 py-3">
        <h4 id={headingId} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-eyebrow text-content-subtle">
          <FileText aria-hidden className="h-4 w-4" />
          PDF Upload
        </h4>
      </div>
      <div className="grid items-end gap-4 border-t border-line px-4 py-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-1">
          <p className="text-sm text-content">{NOW[effective]}</p>
          {choice === "" && question.uploadRuleReason ? (
            <p className="text-[0.8125rem] leading-snug text-content-subtle">Platform decided: {question.uploadRuleReason}</p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm font-semibold text-coral-700">
              {problem}
            </p>
          ) : null}
        </div>
        <SelectField label="Setting" value={choice} disabled={saving} onChange={(event) => void change(event.target.value as Choice)}>
          <option value="">Platform Decides</option>
          <option value="REQUIRED">Required</option>
          <option value="OPTIONAL">Optional</option>
          <option value="NONE">None</option>
        </SelectField>
      </div>
    </section>
  );
}
