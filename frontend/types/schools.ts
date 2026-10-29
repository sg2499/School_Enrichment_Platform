/** Schools, for the Super Admin (#211): /api/schools-admin. */

export interface SchoolCounts {
  admins: number;
  teachers: number;
  students: number;
  sections: number;
  /** Active people still on their first password. */
  notSignedIn: number;
  inactivePeople: number;
  lastActiveAt: string | null;
}

export interface SchoolRow {
  id: string;
  name: string;
  board: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdAt: string | null;
  logoUrl: string | null;
  counts: SchoolCounts;
}

export interface BoardOption {
  code: string;
  name: string;
}

export interface SchoolsList {
  schools: SchoolRow[];
  boards: BoardOption[];
}

export interface SchoolAdminRow {
  id: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  /** Has chosen their own password. */
  signedIn: boolean;
  twoFactor: boolean;
  lastActiveAt: string | null;
}

export interface SchoolDetail {
  school: SchoolRow;
  admins: SchoolAdminRow[];
  boards: BoardOption[];
}

/** A new admin's sign-in details, shown once. */
export interface AdminCredentials {
  fullName: string;
  email: string;
  initialPassword: string;
}

export interface SchoolCreated {
  school: SchoolRow;
  admin: AdminCredentials;
}
