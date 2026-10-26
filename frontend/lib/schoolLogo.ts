/**
 * The school's logo (#202): where the app finds its address, and how a new
 * upload reaches every part of the page at once. Pure apart from the
 * browser event, so tests/unit/schoolLogo.test.mjs covers the checks.
 */
export const SCHOOL_LOGO_EVENT = "school-enrichment-school-logo-changed";
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const LOGO_MAX_BYTES = 3_000_000;

/** Why a chosen file can't be the logo, or null when it can be. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "Please choose a PNG, JPG or WEBP image.";
  if (file.size <= 0) return "That file is empty. Please choose the logo image again.";
  if (file.size > LOGO_MAX_BYTES) return "That image is too large. Please choose one under 3 MB.";
  return null;
}

/** Tells the side rail (and anything else showing the logo) that it changed. */
export function announceSchoolLogo(url: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string | null>(SCHOOL_LOGO_EVENT, { detail: url }));
}
