# MVP Plan

Proposed feature backlog for a household meal-planner + shopping list app.
Nothing here is built yet except Phase 0 — this is a proposal to align on
before we start building features.

## Phase 0 — Infrastructure (this session)
- [x] Repo, module scaffold, boundary lint rule
- [x] Supabase client wiring (preprod)
- [x] `households` / `household_members` schema + RLS
- [x] CI (type-check, lint, test)
- [x] Branch protection on `main`/`develop`
- [x] Vercel project + environments
- [ ] `la-bonavida-prod` Supabase project — attempted 2026-09-12 and
      blocked by the free tier's 2-active-project limit; still deferred
      until launch-ready. See `DECISIONS.md`.

## Phase 1 — Auth & households

**Status: built**, on branch `feature/phase-1-auth-households` (migrations
applied to preprod, typecheck/lint/unit tests/production build all pass,
21/21 pgTAP assertions verified against preprod). Two known gaps at
merge time, both flagged rather than silently assumed fine:
- The new `db-tests` CI job (pgTAP via `supabase start`) could not be run
  in this environment (no Docker/Supabase CLI available) — written per
  documented Supabase CLI conventions, but unverified end-to-end. Watch
  its first real run.
- Full interactive testing (magic-link email click-through, a real
  multi-account invite acceptance) needs manual verification — no email
  inbox or browser access in this environment; only route-level behavior
  was smoke-tested (redirects, rendering) via curl against the dev server.

Requirements decided in planning (see `DECISIONS.md` for the full
reasoning) — this replaces the original bullet list:

- **Sign in:** magic link only (no password). Session persists via cookies;
  re-login only needed on a new device/cleared session, not every visit.
- **Roles:** `owner` / `member` only (schema unchanged from Phase 0). A
  household may have multiple owners; any owner can rename, delete, invite
  (as either role), promote/demote any member's role, or remove any member
  including another owner — no tiebreakers.
- **Zero-owner guard (new DB invariant):** a household can never end up
  with no owners. An owner can only remove *or demote* themselves if
  another owner remains; otherwise they must promote someone else first or
  delete the household. Enforced in Postgres, not just the UI.
- **Invites:** single-use, expiring links (`household_invites`: token,
  household, role, invited_by, created_at — no status column, single-use
  is enforced by deleting the row on accept) — not tied to any email. An
  owner generates a link for a chosen role and sends it however they want,
  outside the app. Declining does nothing to the row; it stays valid until
  it expires or is revoked. Expires after 7 days, swept by a scheduled
  `pg_cron` cleanup job (built now, not deferred); revocable by any owner;
  rate-limited to 5 new links/day/household **and** 10/day/person across
  all their households; the pending-links list is owner-only. Lookup and
  accept go through two `SECURITY DEFINER` functions
  (`private.get_invite`, `accept_household_invite`) rather than a broad
  table policy, so a token can only ever be looked up one-at-a-time by
  someone who already has it — never listed. No Supabase Admin API /
  service-role key involved. Members cannot generate invite links.
- **Profile:** a `public.profiles` row (alias only, non-unique) is required
  immediately after first authentication — before onboarding or an invite
  accept/decline screen — since `auth.users`/email is never client-visible
  and other people need *something* readable to see. No auto-generated
  default; the user picks it once, and can edit it anytime after.
- **Onboarding:** a user with no household lands on "create a household."
  Someone arriving via an invite link gets its own accept/decline step
  ("you've been invited to X as Y"), signing in (and setting an alias, if
  new) first if needed. Accepting is never automatic.
- **Switching households:** URL-based (`/households/[id]/...`), no
  remembered "current household" state. RLS already refuses data for a
  household URL the user isn't a member of.
- **Household settings page:** rename, view members + roles + aliases,
  promote/demote a member, remove a member, leave (all subject to the
  zero-owner guard above), edit your own alias, plus (owners only)
  view/revoke pending invite links.
- **`household_members.user_id` references `profiles(id)`**, not
  `auth.users(id)` directly — makes "must have a profile before joining a
  household" a real DB constraint, not just a UI convention.
- **Account deletion (not a Phase 1 feature, noted for later):** blocked by
  the zero-owner guard if the user is a household's sole owner — they must
  transfer ownership or delete the household first. Intentional.
- **Testing:** add `pgTAP` for this phase's DB-level invariants (zero-owner
  guard, both rate limits, `household_invites`/`profiles` RLS boundaries,
  `accept_household_invite`) as part of the CI bar, alongside the existing
  type-check/lint/unit-test checks.
- **Indexes:** unique index on `household_invites.token`; composite
  `(household_id, created_at)` and `(invited_by, created_at)` indexes
  (serve both rate-limit checks and the pending-invites list).
- **Cleanup job:** `pg_cron`, once daily.
- **Data layer:** roster and pending-invites list are each one joined
  query — no N+1 per-member/per-invite profile fetches.
- **Fetching:** Server Components fetch data during render; mutations go
  through Server Actions from small Client Component buttons/forms — see
  `CLAUDE.md` for the standing convention.

## Phase 2 — Ingredients

**Status: built**, merged to `develop` across five PRs (#5 reference
schema, #6 ingredient schema, #8 i18n, #9 seed pipeline, #10 browse UI),
plus a post-build review pass that fixed three real defects and four
smaller gaps. Migrations applied to preprod; typecheck, lint, 90 unit
tests, 136 pgTAP assertions and the production build all pass.

**All 62 ingredients are loaded in preprod** and every seed-sanity
invariant returns clean.

**The post-build review** (see `DECISIONS.md`, "Phase 2 post-build
review") found that two verification passes had both asked "does the
planned work exist?" and neither had asked "what would a bug here look
like?". Three defects had passed every existing test:
`upsert_ingredient` accepted an ingredient with no name in any language;
nothing anywhere required the EU-mandatory nutrients (all 62 had them by
curation, not by rule); and the food-group filter only worked because of
a null check that read as a type guard. All three are fixed, with
assertions that fail if they come back. The method that found them —
call each write path with what it should refuse — is now the habit for
Phase 3.

Remaining gaps, flagged rather than quietly assumed fine:

- **The seed dataset is 62 ingredients, not the 150–250 targeted.** All
  13 food groups are covered and every entry carries all eight
  EU-mandatory nutrient values (the seven required declarations, with
  energy stored in both kJ and kcal) — now enforced by the importer and
  by a pgTAP invariant rather than left to careful curation. Reaching the
  target is continued curation on working, re-runnable infrastructure
  rather than new engineering.
- **Search is accent-tolerant but not typo-tolerant.** "platano" finds
  "Plátano"; "platno" does not. Matching happens in the application after
  fetching the catalog, which is correct and fast at this size — the known
  ceiling is the ~5,000-ingredient figure in `PHASE_2_PLAN.md` §8.5.
  Pushing search into Postgres needs the `unaccent` extension plus an
  index, which is the same job as real typo tolerance, so both wait for
  whichever is needed first.
- **Verification used a temporary password user**, since this environment
  has no email inbox for the magic-link flow. Pages were rendered in all
  three locales against preprod and the user was removed afterwards, but
  a real magic-link click-through is still unverified — the same gap
  Phase 1 recorded.

**Detailed build spec: `PHASE_2_PLAN.md`** — schema, module layout,
build sequence, and the testing bar to clear before this phase is done.
The bullets below stay the roadmap-level summary.

- **Global** ingredient catalog — shared across all households, not
  scoped to one. Deliberate exception to the usual `household_id`-scoped
  rule; see `DECISIONS.md`.
- **Admin-curated, not user-writable.** Authenticated users get read-only
  access (browse/search); no household can insert, edit, or delete a
  catalog entry. The catalog's only write path is the
  `upsert_ingredient` database function, called by
  `pnpm run seed:ingredients` under the service role — `EXECUTE` on it is
  revoked from `anon` and `authenticated`. Since there's no user-write
  path, there's no duplicate/moderation/abuse problem to design around at
  all. See `DECISIONS.md`.
- **Withdrawing an ingredient is a retirement, not a delete.**
  `set_ingredient_retired(code, true)` stamps `retired_at` and the
  `ingredients_select` policy hides the row from readers, while the row
  itself survives so anything already referencing it keeps resolving —
  which is what makes it safe once Phase 3 recipes hold a foreign key to
  the catalog. Re-running the seed never un-retires anything. The importer
  reports live codes missing from the dataset but never acts on them. See
  `DECISIONS.md`.
- **Nutrition values:** the full EU-standard set (Regulation 1169/2011
  Annex XIII — 7 mandatory macros, 5 voluntary macros, ~13 vitamins, ~14
  minerals), stored **normalized**: a seeded `nutrients` reference table
  (code, name, unit, category) + an `ingredient_nutrients` value table
  (ingredient_id, nutrient_id, value_per_100g) holding only the values
  actually known per ingredient. Matches how real food-composition
  databases (USDA FoodData Central, the Spanish BEDCA) model this — the
  data is genuinely sparse, and it suits "sum this across a day's meals"
  (one SQL `group by nutrient_id, sum(...)`) better than a wide table
  would. See `DECISIONS.md`.
- **Food groups:** each ingredient has exactly one required
  `food_group_id`, from a fixed 13-group taxonomy sourced from AESAN's
  "Recomendaciones Dietéticas Saludables y Sostenibles" (Dec 2022):
  Hortalizas, Frutas, Patatas y otros tubérculos, Cereales, Legumbres,
  Frutos secos, Pescado y marisco, Huevos, Leche y lácteos, Carne, Aceite
  de oliva, Agua, Alimentos y bebidas a limitar. Each group's
  serving-frequency guidance from the source document is captured as a
  note on the group row now — cheap to grab while reading the source,
  not consumed by any feature yet (a future "did this week's meal plan
  meet the recommendations" feature would use it).
- **Allergens & dietary restrictions:** one unified system, not two — a
  `dietary_tags` reference table (`category`: `allergen` or `diet`)
  seeded with the EU's 14 official allergens plus diet labels
  (vegetarian, vegan, more later), and an `ingredient_dietary_tags` join
  table. Replaces hardcoded `is_vegetarian`/`is_vegan` columns — adding a
  new diet type (halal, keto, ...) later is a data insert, not a
  migration. Tagged by the admin in the same curation pass as nutrition/
  food groups, not automated. See `DECISIONS.md`.
- **Units:** a `units` reference table (code, `dimension` — mass/volume/
  count, `to_base_factor` for same-dimension conversion, e.g. g↔kg,
  ml↔l) plus `ingredient_allowed_units` (which units make sense for this
  specific ingredient — e.g. eggs by count only, milk by volume only).
  Cross-dimension conversion (cups of flour → grams) is out of scope —
  needs a per-ingredient density value, a real feature for later, not
  now. Phase 3 will enforce that a recipe's ingredient lines can only use
  units that ingredient allows, and can only reference ingredients that
  exist in the catalog.
- **Multi-language ingredient names:** a `locales` reference table
  (Spanish required as the default; Catalan and English from the start,
  more later) plus `ingredient_translations` (ingredient_id, locale,
  name) — the first application of the system-wide translation-companion
  -table pattern. See `ARCHITECTURE.md` ("Internationalization") and
  `DECISIONS.md` — every future module with translatable content
  (recipes, shopping lists, ...) reuses the same pattern.
- **Seasonality:** a `regions` reference table (seeded with `es` only) plus
  `ingredient_seasonality` (ingredient, region, month) — one row per
  in-season month, so wraparound seasons (citrus, Nov–Mar) and split
  harvests work without special-casing. Captured now for a future
  "prioritise seasonal ingredients/recipes" feature; nothing consumes it
  in Phase 2. Deliberately *not* modelled as dietary-style tags — it's a
  three-way ingredient × region × month relationship, not boolean
  membership. See `DECISIONS.md`.
- **Household region:** `households.region_id` (not null, defaults to
  Spain, changeable by any owner from the household settings page) — the
  one Phase 2 change to an existing Phase 0/1 table, and what makes the
  seasonality data addressable. The existing owner-only `households_update`
  policy already covers it; `create_household()` is updated to set the
  default. See `PHASE_2_PLAN.md` §2.6.
- **Search:** plain name search for now, against the requester's locale
  with fallback to Spanish. Typo tolerance and accent/case insensitivity
  (Postgres's built-in `pg_trgm` / `unaccent` extensions) are
  deliberately deferred — added later purely via an index, no schema
  change needed, so there's no cost to waiting.
- **Needs a real seed list before beta**, not an empty table — a curated
  set of common ingredients (by hand or imported from an open dataset
  such as USDA FoodData Central / Open Food Facts / BEDCA) so the first
  recipe anyone builds doesn't immediately hit a missing ingredient.
- Reuse ingredients across recipes instead of retyping them

## Phase 3 — Recipes
- Create/edit/delete a recipe (title, servings, instructions)
- Attach ingredients + quantities to a recipe (references the Phase 2
  catalog — never a free-text ingredient name)
- Browse/search recipes within a household
- Recipes are household-scoped and translatable, reusing the Phase 2
  translation-companion-table pattern (`recipe_translations`)

### A cooked recipe can be an ingredient of another recipe

Cooked white rice is eaten on its own *and* used inside other dishes. So
a recipe line points at **either** a catalog ingredient **or** another
recipe. Full reasoning in `DECISIONS.md`; the roadmap-level shape:

```sql
recipe_lines (
  recipe_id     -> recipes(id),
  ingredient_id -> ingredients(id)  null,
  sub_recipe_id -> recipes(id)      null,
  quantity numeric not null,
  unit_id       -> units(id),
  check (num_nonnulls(ingredient_id, sub_recipe_id) = 1)
)
```

**The two columns go in Phase 3's first migration even though the feature
ships later.** There is no recipe schema yet, so today this is one column
and one constraint; after households have saved real recipes the same
change is a data migration on live data. Same call the project already
made for i18n — decided early so it would not be a retrofit. What is
deferred is the work (picker UI, nutrition roll-up, shopping-list
recursion), not the shape.

**A recipe is not promoted into the ingredients catalog.** That catalog is
global and admin-curated on purpose; recipes are household-scoped and
user-written. Promoting one into the other would either put household
data in a shared table or reopen the user-writable-shared-resource
problem the growth-trajectory note above exists to avoid.

Four consequences, each easy to miss:

1. **Yield is entered, not derived.** `recipes` needs `yield_quantity` +
   `yield_unit_id`, filled in by whoever writes the recipe. It cannot be
   computed by summing input weights: 300 g of raw rice becomes ~750 g
   cooked because it absorbs water. Nutrition for a sub-recipe line is
   the sub-recipe's total ÷ its yield. Same usability-over-precision
   stance as the per-count 100 g equivalence decision.
2. **Cycles must be blocked in Postgres.** A → B → A is an infinite loop
   in both nutrition roll-up and the shopping list. A recursive CTE in a
   trigger on insert/update — a real invariant, so it belongs in the
   database, not in a Server Action.
3. **A sub-recipe reference must stay inside its own household**,
   otherwise `sub_recipe_id` is a cross-household data leak. A plain FK
   to `recipes(id)` cannot say that. A composite FK can, and makes it
   structurally impossible rather than trigger-enforced:
   `recipes` gets `unique (household_id, id)`, and `recipe_lines` carries
   `household_id` with
   `foreign key (household_id, sub_recipe_id) references recipes (household_id, id)`.
   This is the same preference as Phase 2's `is_default` flag on
   `ingredient_allowed_units` — express the rule in the schema so it
   cannot be violated.
4. **Unit validation has two branches.** A line referencing a catalog
   ingredient is restricted to that ingredient's `ingredient_allowed_units`.
   A line referencing a sub-recipe has no row there at all, and takes its
   units from the sub-recipe's declared yield unit instead. Phase 2's
   table comment used to promise only the first half; corrected in
   `20260912110000`.

**Knock-on effects in later phases**, recorded here so they are not a
surprise:
- **Phase 5 (shopping lists)** must recurse through sub-recipe lines to
  reach leaf catalog ingredients — a recursive CTE, not a single join.
- **Phase 6 (fridge)** has the identical either-or shape: cooked rice in
  the fridge is a real thing you have, not just raw ingredients.

**Still open before building** (unchanged, but note that sharing now
interacts with the above): the recipe language model, who may edit a
recipe within a household, non-numeric quantities ("to taste"), and
whether recipe sharing between households is designed now. If recipes can
ever be shared, the composite FK in point 3 is what stops a shared recipe
from dragging along a sub-recipe the recipient cannot see — so sharing is
better answered before that migration than after.

## Phase 4 — Meal plans
- Assign recipes to days of a week
- View a week at a glance
- Copy a previous week's plan as a starting point

## Phase 5 — Shopping lists
- Generate a shopping list from a meal plan's recipes (aggregate quantities
  across recipes, e.g. 2 recipes needing onions → one line item)
- Manually add/remove/check off items
- Multiple household members can see the same list update live
- (No fridge-awareness yet — that's Phase 6. This phase's generation is
  pure recipe-quantity aggregation.)
- **Aggregation has to recurse.** A recipe line can point at another
  recipe (see Phase 3), so reaching the leaf catalog ingredients a
  shopping list is actually made of means a recursive CTE, not a single
  join. A recipe using cooked rice must still put *raw rice* on the list.

## Phase 6 — Fridge / pantry
- Inventory of what a household currently has on hand, scoped to
  household. Like a recipe line, a fridge entry points at **either** a
  catalog ingredient **or** a recipe (see Phase 3) — a tub of cooked rice
  in the fridge is a real thing you have, and the same either-or shape
  and same-household composite FK apply here.
- Manually add/adjust/remove fridge quantities
- Upgrades Phase 5's shopping-list generation to subtract on-hand fridge
  stock: recipes need 2 onions, fridge has 1, list shows "buy 1" — instead
  of asking to buy what's already there
- Checking off a shopping-list item does **not** auto-restock the fridge
  (deliberately deferred — see `DECISIONS.md`); fridge quantities stay a
  manual/explicit update for now

## Phase 7 — Polish
- Mobile-friendly UX polish (touch targets, mobile nav) — the app is
  responsive from the start (see `CLAUDE.md`), so this is refinement, not
  a redesign
- Installable as a PWA (manifest, icons, home-screen install; offline
  access if useful) — this will mostly be used on a phone in a kitchen or
  grocery store, and installability is purely additive metadata on top of
  the existing app, not a rewrite (see `DECISIONS.md`)
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
- **A way for households to request a missing ingredient** — the catalog
  is admin-curated (Phase 2), so a household can't add one themselves.
  Fine while the project owner can just add it directly; needs a real
  suggestion/request flow once other families are on the app and can't
  ask directly. See "Growth trajectory" below.
- **Ingredient substitutes and subtype relationships** (e.g. whole vs.
  skimmed milk, or olive oil ↔ sunflower oil as an interchangeable swap)
  — purely additive relationship layers on top of the Phase 2 catalog,
  so nothing built now needs to anticipate them.
  **Subtypes themselves are not deferred** — variants are curated as
  ordinary separate ingredients in Phase 2 (their nutrition genuinely
  differs, so they need their own rows regardless). What's deferred is
  only the explicit *relationship* linking them, because its value
  depends on swap behaviour that arrives with substitutes, and picking a
  shape now risks baking in an assumption substitutes would have to
  undo. A shared-prefix naming convention in the seed data keeps the
  grouping reconstructible in the meantime — see `PHASE_2_PLAN.md` §6.
  Design both together when there's real behaviour to design against,
  likely alongside or after Phase 3 Recipes.

## Growth trajectory: beta (trusted, small) → public → monetized

From Phase 2 onward, assume the app starts in beta with a small number of
known households, but is eventually opened to the public and monetized.
This doesn't change how Phases 2–7 are built now (still MVP-simple, still
YAGNI) — it changes which shortcuts are safe to take. A shortcut that's
fine for a handful of trusted people can become a real abuse or trust
problem once strangers show up, so anywhere a decision opens a shared
resource to user input, prefer the option that doesn't need to be
re-architected later, even if it costs a few extra lines now. Worked
example: the global ingredients catalog ended up **admin-curated, not
user-writable at all** (see `DECISIONS.md`) — the strongest version of
this principle, since removing the user-write path removes the abuse
surface entirely instead of just mitigating it.

**Pre-public-launch checklist (not beta scope, revisit before opening
signups):**
- Ingredient request/suggestion flow, now that households can't add
  catalog entries themselves (see "Deliberately deferred" above).
- Rate-limiting on any open-write shared resource (pattern already exists
  for `household_invites` — reuse it if a future feature needs it).
- Whatever monetization requires (billing integration, plan limits) —
  undefined until we're closer to that point.
