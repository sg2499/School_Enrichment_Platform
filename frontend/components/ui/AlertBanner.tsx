import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertTone = "error" | "success" | "info";

const TONES: Record<AlertTone, { box: string; icon: string; text: string; Icon: typeof AlertCircle }> = {
  // coral-800 on coral-50 9.0:1; jade-800 on jade-50 8.9:1; brand-800 on
  // surface-brand 10.6:1. The icon carries the state as well as the colour.
  error: { box: "border-coral-200 bg-coral-50", icon: "text-coral-600", text: "text-coral-800", Icon: AlertCircle },
  success: { box: "border-jade-200 bg-jade-50", icon: "text-jade-600", text: "text-jade-800", Icon: CheckCircle2 },
  info: { box: "border-line-brand bg-surface-brand", icon: "text-brand-600", text: "text-brand-800", Icon: Info },
};

/**
 * One-line status message inside a page or card: an error a request came
 * back with, a confirmation, or a quiet note. Lifted out of the old
 * teacher/assignments page (where it was a local helper) once the Practice
 * Tracker's pages all needed the same thing.
 */
export function AlertBanner({
  tone,
  message,
  action,
  className,
}: {
  tone: AlertTone;
  message: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-2xl border p-4 animate-scale-in", t.box, className)}
    >
      <t.Icon className={cn("mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0", t.icon)} aria-hidden />
      <div className={cn("min-w-0 flex-1 text-[0.875rem] font-medium leading-[1.55]", t.text)}>{message}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
