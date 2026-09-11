/**
 * Pure validation helpers. The database enforces these too (check
 * constraints, RLS) - this layer exists to give a friendly error before a
 * network round trip, not as the actual security boundary.
 *
 * These return message *keys*, not sentences. `domain/` is deliberately
 * framework-agnostic (see ARCHITECTURE.md), so it must not import
 * next-intl or know what language the caller reads - it names the problem
 * and lets `ui/` look the wording up in the active locale's catalog.
 */

/** Keys into the `Validation` namespace of the message catalogs. */
export type ValidationKey =
  | "aliasRequired"
  | "aliasTooLong"
  | "householdNameRequired"
  | "householdNameTooLong"
  | "invalidRole";

/**
 * Checks a candidate alias against the same rules the database enforces
 * (`profiles_alias_length`, non-empty) - lets the form show an error
 * without a round trip, not the real security boundary.
 * @param alias The raw, untrimmed value from the alias input field.
 * @returns A `Validation` message key for the UI to translate, or `null`
 * if valid.
 */
export function validateAlias(alias: string): ValidationKey | null {
  if (alias.trim().length === 0) {
    return "aliasRequired";
  }
  if (alias.length > 60) {
    return "aliasTooLong";
  }
  return null;
}

/**
 * Checks a candidate household name against the same rules the database
 * enforces (`households_name_length`, `households_name_not_empty`).
 * @param name The raw, untrimmed value from the household-name input field.
 * @returns A `Validation` message key for the UI to translate, or `null`
 * if valid.
 */
export function validateHouseholdName(name: string): ValidationKey | null {
  if (name.trim().length === 0) {
    return "householdNameRequired";
  }
  if (name.length > 100) {
    return "householdNameTooLong";
  }
  return null;
}

export type MemberRole = "owner" | "member";

export function isMemberRole(value: string): value is MemberRole {
  return value === "owner" || value === "member";
}
