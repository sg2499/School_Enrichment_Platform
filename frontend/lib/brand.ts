/**
 * What the product is called, in one place (3 Oct 2026).
 *
 * The product is **Krama** -- Sanskrit for order, sequence, one step after
 * another -- made by Zetta Metrics. Until this date it carried its working
 * title, "School Enrichment", typed out by hand in fourteen files. Every
 * screen, tab title, error sentence and download now reads the name from
 * here, so the name can never be one thing on the sign-in page and another
 * in an error message, and changing it is one edit.
 *
 * What is deliberately NOT renamed: the repository, folder names, the
 * `school_enrichment_*` browser-storage keys and the `se_*` cookies. Those
 * are internal identifiers nobody reads, and renaming the storage keys would
 * sign every person out for nothing.
 *
 * Kept free of imports so the modules under unit test can depend on it (see
 * scripts/run-unit-tests.mjs).
 */

/** The name, wherever the product names itself. */
export const PRODUCT_NAME = "Krama";

/** The name as it appears in the names of files people download. */
export const PRODUCT_SLUG = "krama";

/** The company behind it, wherever the product credits its maker. */
export const COMPANY_NAME = "Zetta Metrics";

/** The maker's credit, as one phrase. */
export const PRODUCT_CREDIT = `A product of ${COMPANY_NAME}`;

/** The company's own website. Wherever the product shows the company's
 *  logo, the logo links here, and always in a new window: someone signing
 *  in should never lose the sign-in page to it. */
export const COMPANY_URL = "https://www.zetta-metrics.com";

/** Who the product is for, as the line that sits under the wordmark. */
export const PRODUCT_SCOPE = "CBSE · ICSE · Class 5–10";
