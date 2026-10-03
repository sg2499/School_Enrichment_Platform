import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageTitle";

// The tab's title from the first byte, before any page has run: every page
// under here is a client component and names itself once it has loaded
// (lib/hooks/usePageTitle.ts, through RoleShell). `absolute` so the root
// layout's "%s · Krama" template is not applied on top.
//
// School Admin and Super Admin share these routes, and which of the two is
// signed in is only known in the browser. So this first title names neither
// (it used to say "Admin" for both, which is one of them): just the product,
// until RoleShell sets the page's own title a moment later.
export const metadata: Metadata = {
  title: { absolute: pageTitle(null) },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
