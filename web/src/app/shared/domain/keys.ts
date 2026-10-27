export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
export const TEST_CASE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-TC-\d+$/;
export const REGRESSION_SESSION_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-R-\d+$/;
export const DOC_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-D-\d+$/;

/// Ticket keys inside free text (spec section 2, Markdown). The lookbehind keeps the `TC-7` in
/// `WEB-TC-7` and the `R-3` in `WEB-R-3` from being mistaken for ticket keys.
export const TICKET_KEY_IN_TEXT = /(?<![A-Za-z0-9-])\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/// Ticket keys and doc keys (`WEB-D-12`) inside free text, with the same boundaries; the server's
/// reference index (`DocReferenceParser`) uses the same patterns.
export const REFERENCE_KEY_IN_TEXT = /(?<![A-Za-z0-9-])\b[A-Z][A-Z0-9]{1,9}-(?:D-)?\d+\b/g;

export function projectKeyOf(key: string): string {
  return key.slice(0, key.indexOf('-'));
}
