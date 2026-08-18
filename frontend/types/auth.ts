// Mirrors backend/app/services/auth_service.py's user_payload() shape.
export type UserRole = "ADMIN" | "SUPER_ADMIN" | "TEACHER" | "STUDENT";

export type CurrentUser = {
  id: string;
  fullName: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
  loginId?: string | null;
  isActive?: boolean;
  profilePhotoUrl?: string | null;
  twoFactorEnabled?: boolean;
  student?: {
    id: string;
    schoolId: string;
    schoolName?: string | null;
    studentCode: string;
    customId?: string | null;
    photoUrl?: string | null;
    signatureUrl?: string | null;
    className?: string | null;
    section?: string | null;
  } | null;
  teacher?: {
    id: string;
    schoolId: string;
    schoolName?: string | null;
    teacherCode: string;
    photoUrl?: string | null;
    signatureUrl?: string | null;
    designation?: string | null;
    subjectSpecialization?: string | null;
  } | null;
  // ADMIN only -- SUPER_ADMIN is platform-wide and has no school association.
  admin?: {
    id: string;
    schoolId: string;
    schoolName?: string | null;
  } | null;
};

export type LoginResponse = {
  // No accessToken here -- the session is set via an httpOnly Set-Cookie
  // response header (see backend/app/api/routes_auth.py's login_route()),
  // never handed to page JS where an XSS payload could read it back out.
  tokenType: string;
  user: CurrentUser;
};

export type TwoFactorChallenge = {
  twoFactorRequired: true;
  challengeToken: string;
  tokenType: string;
};

export type LoginResult = LoginResponse | TwoFactorChallenge;

export function isTwoFactorChallenge(result: LoginResult): result is TwoFactorChallenge {
  return (result as TwoFactorChallenge).twoFactorRequired === true;
}
