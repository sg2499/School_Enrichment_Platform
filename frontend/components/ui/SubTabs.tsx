"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type SubTab<K extends string> = {
  key: K;
  label: string;
  href: string;
  icon?: React.ReactNode;
  /** Small count pill; `attention` paints it saffron (work waiting). */
  count?: number | null;
  attention?: boolean;
};

/**
 * A page's own sub-navigation: each tab is a real link to a URL (usually
 * the same page with a different `?tab=`), and the active one carries
 * aria-current="page". Links rather than an ARIA tablist because each tab
 * IS a separate full-width view with its own address -- Back, refresh and
 * bookmarks all work, and a tablist would promise arrow-key behaviour that
 * links don't have. Visual weight matches admin/people's role tabs (the
 * heavier, primary-dimension treatment).
 */
export function SubTabs<K extends string>({
  label,
  tabs,
  active,
  className,
}: {
  label: string;
  tabs: SubTab<K>[];
  active: K;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {tabs.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={false}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-2 rounded-2xl px-4 text-[0.875rem] font-semibold transition duration-200 ease-spring",
              current
                ? "bg-brand-gradient text-content-inverse shadow-brand"
                : "border border-line-strong bg-surface text-content-muted hover:border-brand-300 hover:text-content",
            )}
          >
            {tab.icon ? (
              <span aria-hidden className="inline-flex">
                {tab.icon}
              </span>
            ) : null}
            {tab.label}
            {tab.count !== undefined && tab.count !== null ? (
              // white on the active tab's white/20 wash over brand-700 5.8:1;
              // ink-700 on ink-100 8.6:1; saffron-900 on saffron-100 8.1:1.
              <span
                className={cn(
                  "min-w-[1.5rem] rounded-full px-2 py-0.5 text-center text-[0.6875rem] font-bold tabular",
                  current
                    ? "bg-white/20"
                    : tab.attention && tab.count > 0
                      ? "bg-saffron-100 text-saffron-900"
                      : "bg-ink-100 text-ink-700",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
