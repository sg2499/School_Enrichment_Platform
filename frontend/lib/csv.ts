/**
 * CSV cells for files the browser builds (sign-in details), moved here from
 * the People page on 29 Oct 2026 so Classes & Sections (#210) writes the
 * same file the same way.
 */

/** One CSV cell: quoted when it holds a delimiter/quote/newline, and a
 * leading = + - @ (or tab/CR) neutralised with a ' so a spreadsheet opens a
 * name like "=HYPERLINK(...)" as text, not as a formula. */
export function csvCell(value: string, { exact = false }: { exact?: boolean } = {}): string {
  // `exact` is for the password column: a password must come out of the
  // file as the characters it is, so it is quoted but never altered. (The
  // guard exists for names typed by other people; a password that begins
  // with "@" was chosen by the admin opening the file.)
  const safe = !exact && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
