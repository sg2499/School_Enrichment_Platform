import { notFound } from "next/navigation";

// Every address under /student that no page answers, /student itself included.
// It exists so that such an address gets this workspace's own not-found
// (../not-found.tsx), known on the server, instead of the one for the
// whole site, which cannot tell which workspace it is in until it has
// loaded (components/NotFoundScreen.tsx has the reason that matters).
export default function Missing() {
  notFound();
}
