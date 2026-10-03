import type { Metadata } from "next";

// The sign-in page is a client component and cannot export metadata itself.
// The root layout's template makes this "Sign In · Krama".
export const metadata: Metadata = {
  title: "Sign In",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
