import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageTitle";

// The tab's title from the first byte, before any page has run: every page
// under here is a client component and names itself once it has loaded
// (lib/hooks/usePageTitle.ts, through RoleShell). `absolute` so the root
// layout's "%s · Krama" template is not applied on top.
export const metadata: Metadata = {
  title: { absolute: pageTitle(null, "STUDENT") },
};

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
