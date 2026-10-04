import { NotFoundScreen } from "@/components/NotFoundScreen";

// An address outside every workspace. Inside one, that workspace's own
// not-found answers (app/student/not-found.tsx and its siblings); why there
// are four is in components/NotFoundScreen.tsx.
export default function NotFound() {
  return <NotFoundScreen segment={null} />;
}
