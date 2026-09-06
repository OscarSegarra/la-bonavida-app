/**
 * Pure validation helpers. The database enforces these too (check
 * constraints, RLS) - this layer exists to give a friendly error before a
 * network round trip, not as the actual security boundary.
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
