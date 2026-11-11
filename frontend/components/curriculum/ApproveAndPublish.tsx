"use client";

/**
 * One click from Draft to live: approves every question the checks allow,
 * then publishes each chapter that clears the normal readiness gate. Flagged
 * questions stay for a human, so a chapter that depends on them is held in
 * Review and named in the result. Asks once, because Published is what
 * schools see.
 */

import { useState } from "react";
import { Rocket } from "lucide-react";
import { ErrorBanner, countOf } from "@/components/curriculum/shared";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, errorMessage } from "@/lib/api";
import type { ApproveAndPublishResult } from "@/types/curriculum";

export function ApproveAndPublish({
  chapterIds,
  label,
  scopeLabel,
  onDone,
  variant = "secondary",
}: {
  chapterIds: string[];
  label: string;
  scopeLabel: string;
  onDone: () => Promise<void> | void;
  variant?: "primary" | "secondary";
}) {
  const [asking, setAsking] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ApproveAndPublishResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setProblem(null);
    try {
      const { data } = await api.post<ApproveAndPublishResult>("/curriculum-admin/chapters/approve-and-publish", {
        chapterIds,
        includeUnverified: true,
      });
      setResult(data);
      setAsking(false);
      await onDone();
    } catch (err) {
      setProblem(errorMessage(err, "approve and publish"));
      setAsking(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant={variant}
        leadingIcon={<Rocket className="h-4 w-4" />}
        loading={running}
        loadingLabel="Approving and publishing"
        disabled={chapterIds.length === 0 || running}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
      {result ? (
        <div role="status" className="space-y-1 text-xs leading-relaxed text-content-muted">
          <p>
            Approved <strong className="text-jade-700">{result.approvedCount}</strong> questions and published{" "}
            <strong className="text-jade-700">{countOf(result.publishedChapters.length, "chapter")}</strong>, with{" "}
            {countOf(result.lessonsPublished, "lesson")} and {countOf(result.activitiesPublished, "practice set")} made ready for teachers.
            {result.skippedFlaggedCount > 0 ? ` ${result.skippedFlaggedCount} flagged questions are left for you to read.` : ""}
          </p>
          {result.heldChapters.length > 0 ? (
            <p>
              Held in Review ({result.heldChapters.length}): {result.heldChapters.map((h) => `${h.code} (${h.reason})`).join("; ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {problem ? <ErrorBanner message={problem} /> : null}
      <Modal
        open={asking}
        onClose={() => (running ? undefined : setAsking(false))}
        size="sm"
        title="Approve and Publish?"
        footer={
          <>
            <Button type="button" variant="ghost" disabled={running} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button type="button" loading={running} loadingLabel="Publishing" onClick={() => void run()}>
              Approve and Publish
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">
          This approves every question in {scopeLabel} except the flagged ones, then publishes each chapter that is ready, with its lessons and practice sets, so schools can
          see and use it. A chapter that still needs a flagged question read is held in Review. A published chapter can be archived later.
        </p>
      </Modal>
    </div>
  );
}
