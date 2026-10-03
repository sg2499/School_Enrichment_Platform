import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageTitle";

// The tab's title from the first byte, before any page has run: every page
// under here is a client component and names itself once it has loaded
// (lib/hooks/usePageTitle.ts, through RoleShell). `absolute` so the root
// layout's "%s · Krama" template is not applied on top.
//
// Admin and Super Admin share these routes, and which of the two is signed
// in is only known in the browser, so this first title says "Admin" for
// both; RoleShell corrects it to "Super Admin" as soon as the page is up.
export const metadata: Metadata = {
  title: { absolute: pageTitle(null, "ADMIN") },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
