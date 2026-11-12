"use client";

/**
 * Settings (#224) for the Super Admin, in three sub-tabs so each kind of
 * information has its own page: Platform (what Krama is and who is on it),
 * Sign-In and Security (the rules every account lives by) and Activity (a
 * log of what has happened). Read-only: the rules are set in the product's
 * code, so changing one is a release and not a form -- the page says so
 * rather than showing switches that do nothing. The activity log names
 * staff but never a child, and carries no address, browser or detail.
 */
import { Building2, History, KeyRound, ShieldCheck, Timer } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { activityTime, plural } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { ActivityPage, PlatformSettings as Settings } from "@/types/overview";

type Tab = "platform" | "signin" | "activity";
const ALL = "All";

/** One labelled line of a details card: the label on the left, the value on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-content-muted">{label}</dt>
      <dd className="text-right text-sm font-semibold text-content">{children}</dd>
    </div>
  );
}

/** A single figure with its label, for the row of headline rules. */
function Tile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-line bg-surface p-5">
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-brand text-content-brand" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">{label}</p>
        <p className="mt-1 font-display text-xl font-semibold text-content">{value}</p>
        <p className="mt-0.5 text-[0.8125rem] text-content-muted">{hint}</p>
      </div>
    </div>
  );
}

function PlatformTab({ data }: { data: Settings }) {
  const { product, platform } = data;
  const suspended = platform.schools - platform.activeSchools;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
          <CardTitle>Product</CardTitle>
          <CardDescription>What this platform is and who runs it.</CardDescription>
        </CardHeader>
        <CardBody>
          <dl className="divide-y divide-line">
            <Row label="Product">{product.name}</Row>
            <Row label="Run by">{product.company}</Row>
            <Row label="Environment">
              <Badge tone={product.environment === "Production" ? "success" : "warning"}>{product.environment}</Badge>
            </Row>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
          <CardTitle>Schools and Boards</CardTitle>
          <CardDescription>Who is on the platform. Add or suspend a school under Schools.</CardDescription>
        </CardHeader>
        <CardBody>
          <dl className="divide-y divide-line">
            <Row label="Schools">{platform.schools}</Row>
            <Row label="Active">{platform.activeSchools}</Row>
            <Row label="Suspended">{suspended}</Row>
            <Row label="Boards">
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                {platform.boards.length ? platform.boards.map((b) => <Badge key={b}>{b}</Badge>) : "None"}
              </span>
            </Row>
          </dl>
        </CardBody>
      </Card>
      <p className="text-sm text-content-muted lg:col-span-2">
        A school&rsquo;s logo is set by that school&rsquo;s admin, from their own Settings.
      </p>
    </div>
  );
}

function SignInTab({ data }: { data: Settings }) {
  const { rules, lockoutAttempts, lockoutMinutes } = data.signIn;
  const needSecondStep = rules.filter((r) => r.twoFactor === "Required").map((r) => r.label.toLowerCase());
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Tile
          icon={<KeyRound className="h-5 w-5" />}
          label="Lock After"
          value={plural(lockoutAttempts, "wrong password")}
          hint="In a row, on one account"
        />
        <Tile
          icon={<Timer className="h-5 w-5" />}
          label="Locked For"
          value={plural(lockoutMinutes, "minute")}
          hint="Then the person can try again"
        />
        <Tile
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Second Step"
          value="Required for admins"
          hint={needSecondStep.length ? `${needSecondStep.join(" and ")}` : "Not required for anyone"}
        />
      </div>
      <Card>
        <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
          <CardTitle>Session Rules by Account</CardTitle>
          <CardDescription>
            How long each kind of account can stay signed in. These are set in the product itself, so they are shown here and not editable: ask the team to change one.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Table caption="Sign-in rules by kind of account" minWidth="36rem">
            <THead>
              <TH>Account</TH>
              <TH>Signed Out After Inactivity</TH>
              <TH>Longest Single Sign-In</TH>
              <TH>Second Step</TH>
            </THead>
            <TBody>
              {rules.map((rule) => (
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
        </CardBody>
      </Card>
    </div>
  );
}

function ActivityTab() {
  const url = useUrlState();
  const group = url.get("group") ?? ALL;
  const page = pageFromParam(url.get("page"));
  const log = useApiQuery<ActivityPage>(
    "/overview/activity",
    { category: group === ALL ? null : group, page, pageSize: 25 },
    { action: "load the activity log" },
  );
  const data = log.data;
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          What happened, who did it and when, newest first. A student is shown as &ldquo;A student&rdquo;, and no address or browser is kept on this page.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <FilterChips
          label="Show activity for"
          value={group}
          options={[ALL, ...(data?.groups ?? (group === ALL ? [] : [group]))].map((name) => ({ value: name, label: name }))}
          onChange={(name) => url.set({ group: name === ALL ? null : name, page: null })}
        />
        {log.problem ? <LoadError problem={log.problem} onRetry={log.reload} /> : null}
        {!data && !log.problem ? <TableSkeleton label="Loading the activity" rows={6} /> : null}
        {data && data.items.length === 0 ? (
          <EmptyState title="Nothing Here Yet" description="Activity of this kind will appear here as it happens." />
        ) : null}
        {data && data.items.length > 0 ? (
          <>
            <Table caption="Recent activity on Krama" minWidth="40rem" busy={log.loading}>
              <THead>
                <TH>When</TH>
                <TH>What Happened</TH>
                <TH>Group</TH>
                <TH>Who</TH>
              </THead>
              <TBody>
                {data.items.map((item) => (
                  <TR key={item.id}>
                    <TD className="whitespace-nowrap tabular text-content-muted">{activityTime(item.at)}</TD>
                    <TD className="font-semibold">{item.event}</TD>
                    <TD>
                      <Badge>{item.group}</Badge>
                    </TD>
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
              onPageChange={(next) => url.set({ page: next === 1 ? null : next })}
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
  const url = useUrlState();
  const settings = useApiQuery<Settings>("/overview/platform", {}, { action: "load the platform settings" });
  const data = settings.data;
  const raw = url.get("tab");
  const active: Tab = raw === "signin" || raw === "activity" ? raw : "platform";
  const tabs: SubTab<Tab>[] = [
    { key: "platform", label: "Platform", href: "/admin/settings", icon: <Building2 className="h-4 w-4" /> },
    { key: "signin", label: "Sign-In and Security", href: "/admin/settings?tab=signin", icon: <ShieldCheck className="h-4 w-4" /> },
    { key: "activity", label: "Activity", href: "/admin/settings?tab=activity", icon: <History className="h-4 w-4" /> },
  ];
  const value = (v: string | number | undefined) => (settings.problem ? "—" : data && v !== undefined ? v : null);

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Operations"
        title="Settings"
        description="The platform's details, the sign-in rules every account follows, and a log of what has happened."
        stats={[
          { label: "Environment", value: value(data?.product.environment) },
          {
            label: "Schools",
            value: value(data?.platform.schools),
            hint: data ? `${data.platform.activeSchools} active` : undefined,
          },
          { label: "Boards", value: value(data?.platform.boards.join(", ") || "None") },
          { label: "Admin Second Step", value: value(data ? (data.signIn.rules.some((r) => r.twoFactor === "Required") ? "Required" : "Not used") : undefined), hint: data ? "For admins and Super Admins" : undefined },
        ]}
      />
      <SubTabs label="Settings sections" tabs={tabs} active={active} />
      {active === "activity" ? (
        <ActivityTab />
      ) : (
        <>
          {settings.problem ? <LoadError problem={settings.problem} onRetry={settings.reload} /> : null}
          {!data && !settings.problem ? <TableSkeleton label="Loading the settings" rows={4} /> : null}
          {data ? active === "signin" ? <SignInTab data={data} /> : <PlatformTab data={data} /> : null}
        </>
      )}
    </div>
  );
}
