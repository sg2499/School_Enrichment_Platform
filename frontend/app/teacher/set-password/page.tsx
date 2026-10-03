"use client";

import { SetPasswordScreen } from "@/components/SetPasswordScreen";

/** Where a teacher still on an issued password is sent from every page of
 *  their workspace. See components/SetPasswordScreen.tsx. */
export default function TeacherSetPasswordPage() {
  return <SetPasswordScreen role="TEACHER" />;
}
