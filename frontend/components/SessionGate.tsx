"use client";

import { Hourglass, RotateCw, ServerCrash, Timer, TriangleAlert, WifiOff } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/brand";
import type { ErrorKind } from "@/lib/errors";
import type { ProtectedPage } from "@/lib/hooks/useProtectedPage";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { StatusScreen, type StatusTone } from "@/components/ui/StatusScreen";

const LOOK: Partial<Record<ErrorKind, { icon: React.ReactNode; eyebrow: string; tone: StatusTone }>> = {
  offline: { icon: <WifiOff />, eyebrow: "No connection", tone: "attention" },
  network: { icon: <WifiOff />, eyebrow: "Connection", tone: "attention" },
  timeout: { icon: <Hourglass />, eyebrow: "Connection", tone: "attention" },
  unavailable: { icon: <Hourglass />, eyebrow: "Starting up", tone: "attention" },
  rateLimited: { icon: <Timer />, eyebrow: "One moment", tone: "attention" },
  server: { icon: <ServerCrash />, eyebrow: "Our side", tone: "problem" },
};
const FALLBACK_LOOK = { icon: <TriangleAlert />, eyebrow: "Something went wrong", tone: "problem" as StatusTone };

/**
 * What a signed-in page shows until its session check says it may render
 * (lib/hooks/useProtectedPage.ts): the loading screen while the check runs
 * or a redirect is under way, and -- new on 3 Oct 2026 -- a screen of its
 * own when the check could not be made at all.
 *
 * That last case used to be indistinguishable from "not signed in": any
 * failure cleared the session and sent the person to the sign-in page. A
 * server that was still waking up therefore signed people out. Now they are
 * told what happened, in words written for their role, and can try again
 * from where they are.
 */
export function SessionGate({ session }: { session: ProtectedPage }) {
  const { status, problem, retry } = session;
  if (status !== "unreachable" || !problem) {
    return <LoadingScreen />;
  }
  const look = LOOK[problem.kind] ?? FALLBACK_LOOK;
  return (
    <StatusScreen
      icon={look.icon}
      tone={look.tone}
      eyebrow={look.eyebrow}
      title={problem.title}
      message={problem.message}
      actions={
        <Button onClick={retry} leadingIcon={<RotateCw className="h-4 w-4" />}>
          Try Again
        </Button>
      }
      announce
      footnote={`This hasn't signed you out. Once ${PRODUCT_NAME} can be reached again, Try Again carries on from here.`}
    />
  );
}
