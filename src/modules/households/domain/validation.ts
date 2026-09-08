/**
 * Pure validation helpers. The database enforces these too (check
 * constraints, RLS) - this layer exists to give a friendly error before a
 * network round trip, not as the actual security boundary.
 */

/**
 * Checks a candidate alias against the same rules the database enforces
 * (`profiles_alias_length`, non-empty) - lets the form show an error
 * without a round trip, not the real security boundary.
 * @param alias The raw, untrimmed value from the alias input field.
 * @returns An error message to show the user, or `null` if valid.
 */
export function validateAlias(alias: string): string | null {
  if (alias.trim().length === 0) {
    return "Enter a name.";
  }
  if (alias.length > 60) {
    return "Keep it under 60 characters.";
  }
  return null;
}

/**
 * Checks a candidate household name against the same rules the database
 * enforces (`households_name_length`, `households_name_not_empty`).
 * @param name The raw, untrimmed value from the household-name input field.
 * @returns An error message to show the user, or `null` if valid.
 */
export function validateHouseholdName(name: string): string | null {
  if (name.trim().length === 0) {
    return "Enter a household name.";
  }
  if (name.length > 100) {
    return "Keep it under 100 characters.";
  }
  return null;
}

export type MemberRole = "owner" | "member";

export function isMemberRole(value: string): value is MemberRole {
  return value === "owner" || value === "member";
}
