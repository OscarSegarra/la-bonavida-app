-- Phase 2, slice 2: the ingredient catalog itself.
--
-- One parent table and five companion tables. The split is not incidental:
-- an ingredient's name, nutrition, tags, units and seasonality are each
-- sparse, multi-valued, or both, and modelling any of them as columns on
-- the parent would mean a migration every time a nutrient, language, diet
-- or region is added. As rows, each of those is an insert.
--
-- Like slice 1, all of this is global, admin-curated reference data:
-- readable by any signed-in user, writable by nobody. There is no
-- insert/update/delete policy anywhere below, because under RLS the
-- absence of a policy is already default-deny.

-- ---------------------------------------------------------------------
-- ingredients
-- ---------------------------------------------------------------------

create table public.ingredients (
  id bigint generated always as identity primary key,
  code text not null unique,
  food_group_id bigint not null references public.food_groups (id),
  nutrition_basis text not null
    check (nutrition_basis in ('per_100g', 'per_100ml')),
  density_g_per_ml numeric check (density_g_per_ml > 0),
  grams_per_unit numeric check (grams_per_unit > 0),
  created_at timestamptz not null default now()
);

comment on table public.ingredients is
'The global ingredient catalog. Has no name column: names are per-language rows in public.ingredient_translations, so "code" is the stable identity instead - which is also what makes the seed importer re-runnable and what detail-page URLs are keyed on, since a surrogate id would not survive a re-seed into a fresh environment.';

comment on column public.ingredients.code is
'Stable slug ("milk_whole", "olive_oil_evoo"). The natural key, because names vary by locale and therefore cannot be one. Upserted on by the seed importer.';

comment on column public.ingredients.nutrition_basis is
'Whether this ingredient''s nutrient amounts are per 100 g or per 100 ml. EU labels declare per 100 g for solids and per 100 ml for liquids, so storing the basis per ingredient stops the two being silently mixed in one column. The rule: the ingredient''s DEFAULT allowed unit decides - a volume default gives per_100ml, mass and count defaults both give per_100g. It must be the default rather than "any allowed unit", because liquids like milk and olive oil are declared per 100 ml while also being measurable in grams, and allowing an extra unit must not change what the values are declared against.';

comment on column public.ingredients.density_g_per_ml is
'Approximate grams per millilitre, for ingredients whose allowed units span both mass and volume (oils, milk, honey). Null when the ingredient needs no such bridge. A deliberate approximation: it exists so a tablespoon of oil can be converted to grams at all, and must never be presented as exact nutrition.';

comment on column public.ingredients.grams_per_unit is
'Approximate weight of one countable item (one egg, one lemon), for ingredients allowing a count unit. Null otherwise. Without it a quantity like "2 eggs" cannot be reconciled with nutrition declared per 100 g. Also a deliberate approximation - a large egg is not a medium egg, which is acceptable for meal planning and not for anything claiming precision.';

-- ---------------------------------------------------------------------
-- ingredient_translations
-- ---------------------------------------------------------------------

create table public.ingredient_translations (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  locale text not null references public.locales (code),
  name text not null check (length(trim(name)) > 0),
  primary key (ingredient_id, locale)
);

-- No two ingredients share a case-insensitively identical name within one
-- language. NOTE: case-insensitive only, NOT accent-insensitive - 'Limon'
-- and 'Limón' would both be accepted. Closing that needs the unaccent
-- extension, deferred along with the rest of search tolerance.
create unique index ingredient_translations_locale_name_idx
  on public.ingredient_translations (locale, lower(name));

comment on table public.ingredient_translations is
'Per-language ingredient names. The first use of this project''s standing pattern for translatable content: a companion table per translatable table, rather than a column per locale (which would need an ALTER TABLE on every such table each time a language is added) or one shared cross-module translations table (which would lose a real foreign key and become a resource every module reaches into). Adding a language is an insert. A row missing for the requested locale falls back to the default locale at read time.';

-- ---------------------------------------------------------------------
-- ingredient_nutrients
-- ---------------------------------------------------------------------

create table public.ingredient_nutrients (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  nutrient_id bigint not null references public.nutrients (id),
  amount numeric not null check (amount >= 0),
  primary key (ingredient_id, nutrient_id)
);

-- Deliberately no additional index. The primary key already indexes
-- (ingredient_id, nutrient_id), which serves every "nutrients for these
-- ingredients" lookup. A covering index including amount would buy
-- index-only scans, but on a table of a few thousand rows that fits in
-- cache that is unmeasurable, and it would cost a second index to keep
-- current. Add one if a real query ever proves it necessary.

comment on table public.ingredient_nutrients is
'Nutrient values per ingredient, expressed in the unit on public.nutrients and per the ingredient''s nutrition_basis. Sparse by design: an ingredient carries rows only for the nutrients actually known for it, which is why this is a value table rather than ~40 mostly-null columns. Partial nutrition is a supported state, not a broken one.';

-- ---------------------------------------------------------------------
-- ingredient_dietary_tags
-- ---------------------------------------------------------------------

create table public.ingredient_dietary_tags (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  tag_id bigint not null references public.dietary_tags (id),
  primary key (ingredient_id, tag_id)
);

-- Serves the reverse lookup ("every gluten-free ingredient"), which the
-- primary key cannot: its leading column is ingredient_id.
create index ingredient_dietary_tags_tag_idx
  on public.ingredient_dietary_tags (tag_id);

comment on table public.ingredient_dietary_tags is
'Which allergens an ingredient contains and which diets it suits - one mechanism for both. Tagging at ingredient level rather than recipe level means a recipe''s vegan or allergen status becomes a derived fact (does every one of its ingredients carry the tag?) rather than something anyone tags by hand, and the same holds later for matching against a household member''s stored restrictions.';

-- ---------------------------------------------------------------------
-- ingredient_allowed_units
-- ---------------------------------------------------------------------

create table public.ingredient_allowed_units (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  unit_id bigint not null references public.units (id),
  is_default boolean not null default false,
  primary key (ingredient_id, unit_id)
);

-- Exactly one preselected unit per ingredient.
create unique index ingredient_allowed_units_single_default_idx
  on public.ingredient_allowed_units (ingredient_id) where is_default;

comment on table public.ingredient_allowed_units is
'Which units make sense for a given ingredient - eggs by count, milk by volume, flour by mass or tablespoons. Phase 3 will enforce that a recipe line may only use a unit listed here for the ingredient it references.';

comment on column public.ingredient_allowed_units.is_default is
'The unit to preselect in the UI. Deliberately a flag here rather than a default_unit_id column on public.ingredients: as a column, "the default unit must also be an allowed unit" would be a cross-table rule needing a trigger to enforce, whereas here it is structurally impossible to violate.';

-- ---------------------------------------------------------------------
-- ingredient_seasonality
-- ---------------------------------------------------------------------

create table public.ingredient_seasonality (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  region_id bigint not null references public.regions (id),
  month smallint not null check (month between 1 and 12),
  primary key (ingredient_id, region_id, month)
);

-- Serves "what is in season in this region this month", which the primary
-- key cannot: its leading column is ingredient_id.
create index ingredient_seasonality_region_month_idx
  on public.ingredient_seasonality (region_id, month);

comment on table public.ingredient_seasonality is
'In-season months per ingredient per region, one row per month rather than a start/end range. A range reads more naturally but breaks on two common cases: wraparound (Spanish citrus runs November to March, so start > end and every query needs a special case) and split seasons (two harvests a year, which one range cannot express at all). A row per month makes both free and reduces the lookup to one indexed equality.

Absence of rows is deliberately ambiguous: for Spain, no rows on flour means "not seasonal, available all year", and no rows on mango means "not grown here, imported all year". Both read as "no local season", which is what a prioritise-what-is-in-season feature needs. Telling those two apart is a local-sourcing concern, deferred.';

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.ingredients              enable row level security;
alter table public.ingredients              force  row level security;
alter table public.ingredient_translations  enable row level security;
alter table public.ingredient_translations  force  row level security;
alter table public.ingredient_nutrients     enable row level security;
alter table public.ingredient_nutrients     force  row level security;
alter table public.ingredient_dietary_tags  enable row level security;
alter table public.ingredient_dietary_tags  force  row level security;
alter table public.ingredient_allowed_units enable row level security;
alter table public.ingredient_allowed_units force  row level security;
alter table public.ingredient_seasonality   enable row level security;
alter table public.ingredient_seasonality   force  row level security;

create policy ingredients_select              on public.ingredients              for select to authenticated using (true);
create policy ingredient_translations_select  on public.ingredient_translations  for select to authenticated using (true);
create policy ingredient_nutrients_select     on public.ingredient_nutrients     for select to authenticated using (true);
create policy ingredient_dietary_tags_select  on public.ingredient_dietary_tags  for select to authenticated using (true);
create policy ingredient_allowed_units_select on public.ingredient_allowed_units for select to authenticated using (true);
create policy ingredient_seasonality_select   on public.ingredient_seasonality   for select to authenticated using (true);
