"use client";

import { SetPasswordScreen } from "@/components/SetPasswordScreen";

/** Where a student still on an issued password is sent from every page of
 *  their learning space. See components/SetPasswordScreen.tsx. */
export default function StudentSetPasswordPage() {
  return <SetPasswordScreen role="STUDENT" />;
}
