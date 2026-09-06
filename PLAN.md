# MVP Plan

Proposed feature backlog for a household meal-planner + shopping list app.
Nothing here is built yet except Phase 0 — this is a proposal to align on
before we start building features.

## Phase 0 — Infrastructure (this session)
- [x] Repo, module scaffold, boundary lint rule
- [x] Supabase client wiring (preprod)
- [x] `households` / `household_members` schema + RLS
- [x] CI (type-check, lint, test)
- [ ] Branch protection on `main`/`develop`
- [ ] Vercel project + environments
- [ ] `la-bonavida-prod` Supabase project (deferred until launch-ready)

## Phase 1 — Auth & households
- Sign up / sign in (Supabase Auth, magic link or password)
- Create a household; become its first owner
- Invite a member to a household (email-based, using Supabase test email
  for now)
- Switch between households if a user belongs to more than one
- Household settings page (rename, view members, remove a member)

## Phase 2 — Recipes
- Create/edit/delete a recipe (title, servings, instructions)
- Attach ingredients + quantities to a recipe
- Browse/search recipes within a household

## Phase 3 — Ingredients
- Ingredient catalog scoped to a household (name, default unit)
- Reuse ingredients across recipes instead of retyping them

## Phase 4 — Meal plans
- Assign recipes to days of a week
- View a week at a glance
- Copy a previous week's plan as a starting point

## Phase 5 — Shopping lists
- Generate a shopping list from a meal plan's recipes (aggregate quantities
  across recipes, e.g. 2 recipes needing onions → one line item)
- Manually add/remove/check off items
- Multiple household members can see the same list update live

## Phase 6 — Polish
- Mobile-friendly layout (this will mostly be used on a phone in a kitchen
  or grocery store)
- Empty states / onboarding for a brand-new household
- Basic notifications (e.g. "shopping list updated") — email seam already
  exists (Resend via Supabase custom SMTP) once a domain is available

## Deliberately deferred
- **Extracting `shopping-lists` into a real separate service** — planned
  learning exercise once the app is stable (see `DECISIONS.md`), not part
  of the MVP itself.
- Real transactional email (Resend) — needs a domain first.
- Anything beyond meal planning / shopping lists (the CLAUDE.md mentions
  "future household management" — out of scope until the core loop works).
