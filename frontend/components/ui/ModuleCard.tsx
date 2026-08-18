import { Card, CardIcon } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export interface ModuleCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status?: { label: string; tone?: BadgeTone };
  tone?: "brand" | "accent" | "jade" | "coral";
  className?: string;
}

/**
 * A single upcoming or available module. Used across all three dashboards so
 * "what this workspace will hold" reads the same way for a Class 5 student
 * and a school administrator -- only the copy and density change.
 */
export function ModuleCard({ icon, title, description, status, tone = "brand", className }: ModuleCardProps) {
  return (
    <Card className={cn("group h-full", className)} interactive>
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-accent-gradient transition-transform duration-500 ease-spring group-hover:scale-x-100"
      />
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <CardIcon tone={tone}>{icon}</CardIcon>
          {status ? <Badge tone={status.tone ?? "neutral"}>{status.label}</Badge> : null}
        </div>
        <div className="space-y-1.5">
          <h3 className="font-display text-base font-semibold text-content">{title}</h3>
          <p className="text-[0.8125rem] leading-relaxed text-content-muted">{description}</p>
        </div>
      </div>
    </Card>
  );
}

/** Small key/value row used for profile and school details. */
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <dt className="text-[0.8125rem] text-content-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-[0.8125rem] font-semibold text-content">{value}</dd>
    </div>
  );
}
