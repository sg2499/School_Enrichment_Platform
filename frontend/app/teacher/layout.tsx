import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageTitle";

// The tab's title from the first byte, before any page has run: every page
// under here is a client component and names itself once it has loaded
// (lib/hooks/usePageTitle.ts, through RoleShell). `absolute` so the root
// layout's "%s · School Enrichment" template is not applied on top.
export const metadata: Metadata = {
  title: { absolute: pageTitle(null, "TEACHER") },
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
