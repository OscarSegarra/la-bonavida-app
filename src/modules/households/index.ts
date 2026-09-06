/**
 * Connector for the `households` module.
 *
 * This is the ONLY file other modules are allowed to import from. Everything
 * under domain/, data/, and ui/ is private to this module — enforced by the
 * boundaries ESLint rule in eslint.config.mjs, not just by convention.
 *
 * No functions exposed yet — this module currently only owns the
 * households/household_members schema (see supabase/migrations).
 */

export {};
