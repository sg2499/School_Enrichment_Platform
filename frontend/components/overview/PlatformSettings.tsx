"use client";

/**
 * Settings (#224) for the Super Admin: the platform's details, the sign-in
 * rules every account lives by, and the recent activity log. Read-only: the
 * rules are set in the product's code, so changing one is a release and not
 * a form -- the page says so rather than showing switches that do nothing.
 * The activity log names staff but never a child, and carries no address,
 * browser or detail.
 */
import { useState } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { activityTime, plural } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { ActivityPage, PlatformSettings as Settings } from "@/types/overview";

const ALL = "All";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-content-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-content">{children}</dd>
    </div>
  );
}

function ActivityLog() {
  const [group, setGroup] = useState(ALL);
  const [page, setPage] = useState(1);
  const log = useApiQuery<ActivityPage>(
    "/overview/activity",
    { category: group === ALL ? null : group, page, pageSize: 25 },
    { action: "load the activity log" },
  );
  const data = log.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          What happened, who did it and when, newest first. A student is shown as &ldquo;A student&rdquo;, and no address or browser is kept on this page.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show activity for">
          {[ALL, ...(data?.groups ?? [])].map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={group === name}
              onClick={() => {
                setGroup(name);
                setPage(1);
              }}
              className={
                group === name
                  ? "rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  : "rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              }
            >
              {name}
            </button>
          ))}
        </div>
        {log.problem ? <LoadError problem={log.problem} onRetry={log.reload} /> : null}
        {!data && !log.problem ? <TableSkeleton label="Loading the activity" rows={6} /> : null}
        {data && data.items.length === 0 ? (
          <EmptyState title="Nothing Here Yet" description="Activity of this kind will appear here as it happens." />
        ) : null}
        {data && data.items.length > 0 ? (
          <>
            <Table caption="Recent activity on Krama" minWidth="40rem" busy={log.loading}>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>What Happened</TH>
                  <TH>Group</TH>
                  <TH>Who</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((item) => (
                  <TR key={item.id}>
                    <TD className="whitespace-nowrap tabular">{activityTime(item.at)}</TD>
                    <TD className="font-semibold">{item.event}</TD>
                    <TD>{item.group}</TD>
                    <TD>{item.who ?? "The system"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
              noun="event"
              label="Activity pages"
              busy={log.loading}
            />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function PlatformSettings() {
  const settings = useApiQuery<Settings>("/overview/platform", {}, { action: "load the platform settings" });
  const data = settings.data;
  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Operations"
        title="Settings"
        description="The platform's details, the sign-in rules every account follows, and a log of what has happened. A school's logo is set by that school's admin, from their own Settings."
      />
      {settings.problem ? <LoadError problem={settings.problem} onRetry={settings.reload} /> : null}
      {!data && !settings.problem ? <TableSkeleton label="Loading the settings" rows={4} /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Platform</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Product">{data.product.name}</Fact>
                <Fact label="Run by">{data.product.company}</Fact>
                <Fact label="Environment">
                  <Badge tone={data.product.environment === "Production" ? "success" : "warning"}>{data.product.environment}</Badge>
                </Fact>
                <Fact label="Schools">
                  {data.platform.activeSchools} active of {data.platform.schools}
                </Fact>
                <Fact label="Boards">{data.platform.boards.length ? data.platform.boards.join(", ") : "None"}</Fact>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign-In Rules</CardTitle>
              <CardDescription>
                How long someone can stay signed in, and who must confirm with a second step. These are set in the product itself, so they are shown here and not editable; ask the team to change one.
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-4">
              <Table caption="Sign-in rules by kind of account" minWidth="36rem">
                <THead>
                  <tr>
                    <TH>Account</TH>
                    <TH>Signed Out After Inactivity</TH>
                    <TH>Longest Single Sign-In</TH>
                    <TH>Second Step</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.signIn.rules.map((rule) => (
                    <TR key={rule.role}>
                      <TD className="font-semibold">{rule.label}</TD>
                      <TD>{rule.idle}</TD>
                      <TD>{rule.max}</TD>
                      <TD>
                        <Badge tone={rule.twoFactor === "Required" ? "success" : "neutral"}>{rule.twoFactor}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="text-sm text-content-muted">
                After {plural(data.signIn.lockoutAttempts, "wrong password")} in a row, the account is locked for {plural(data.signIn.lockoutMinutes, "minute")}.
              </p>
            </CardBody>
          </Card>
        </>
      ) : null}

      <ActivityLog />
    </div>
  );
}
