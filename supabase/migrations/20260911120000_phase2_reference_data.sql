-- Phase 2, slice 1: the reference vocabularies the ingredient catalog is
-- built on, plus the household region setting that makes seasonality data
-- addressable.
--
-- Everything here is GLOBAL reference data, not household-scoped. That is a
-- deliberate, logged exception to this project's "every table is scoped to
-- household_id" rule (see CLAUDE.md / DECISIONS.md): none of it is private
-- to a household, and all of it is admin-curated rather than user-written.
-- The security model is therefore read-only-for-everyone rather than
-- per-household isolation.
--
-- Display names live in next-intl message catalogs keyed by these `code`
-- values, NOT in the database - these are fixed vocabularies shipped with
-- the app, unlike ingredient names, which are user-facing content and get
-- their own translation companion table (slice 2). The one exception is
-- locales.name, an endonym: a language's name in its own language is the
-- same in every UI language, so it never needs translating.

-- ---------------------------------------------------------------------
-- locales
-- ---------------------------------------------------------------------

create table public.locales (
  code text primary key,
  name text not null,
  is_default boolean not null default false
);

-- At most one default locale. Postgres cannot express "at least one", so
-- the *existence* of a default is asserted in pgTAP instead - it is
-- load-bearing for translation fallback, which resolves a missing
-- translation to the default locale's row.
create unique index locales_single_default_idx
  on public.locales ((true)) where is_default;

comment on table public.locales is
'Languages the app supports. Referenced by every *_translations table. Exactly one row must carry is_default (Spanish); a missing translation falls back to it at read time.';

comment on column public.locales.name is
'Endonym - the language''s name in its own language ("Català"). Not translated, because it is identical in every UI language.';

insert into public.locales (code, name, is_default) values
  ('es', 'Español', true),
  ('ca', 'Català',  false),
  ('en', 'English', false);

-- ---------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------

create table public.units (
  id bigint generated always as identity primary key,
  code text not null unique,
  dimension text not null check (dimension in ('mass', 'volume', 'count')),
  to_base_factor numeric not null check (to_base_factor > 0)
);

comment on table public.units is
'Quantity units for recipes, shopping lists and the fridge. Shared platform reference data - any module may read it directly rather than routing through the ingredients connector.';

comment on column public.units.to_base_factor is
'Ratio to the base unit of this unit''s dimension (grams for mass, millilitres for volume, 1 for count). Converting between two same-dimension units is arithmetic on these factors, so no pairwise conversion table is needed. Crossing dimensions additionally needs the per-ingredient density or unit weight stored on public.ingredients.';

insert into public.units (code, dimension, to_base_factor) values
  ('g',    'mass',   1),
  ('kg',   'mass',   1000),
  ('ml',   'volume', 1),
  ('l',    'volume', 1000),
  ('unit', 'count',  1),
  ('tbsp', 'volume', 15),
  ('tsp',  'volume', 5);

-- ---------------------------------------------------------------------
-- regions
-- ---------------------------------------------------------------------

create table public.regions (
  id bigint generated always as identity primary key,
  code text not null unique,
  is_default boolean not null default false
);

create unique index regions_single_default_idx
  on public.regions ((true)) where is_default;

comment on table public.regions is
'Markets for ingredient seasonality. Deliberately NOT called "countries": what is in season is what reaches the shops, which is climate plus local agriculture plus trade. A country is a good proxy for compact, market-integrated countries and is how published seasonal calendars are organised, but it breaks for continental-scale ones (US calendars are per state; likewise Brazil, China, India, Australia, Argentina, Chile, Canada). Keeping this granularity-agnostic means "es" today and "us_ca" or "es_canarias" later are all just rows, with no migration or rename.';

comment on column public.regions.is_default is
'Exactly one row must carry this. It is load-bearing beyond reference-data tidiness: create_household() resolves a new household''s region through it, so no default region means household creation fails for every user.';

insert into public.regions (code, is_default) values
  ('es', true);

-- ---------------------------------------------------------------------
-- food_groups
-- ---------------------------------------------------------------------

create table public.food_groups (
  id bigint generated always as identity primary key,
  code text not null unique,
  sort_order int not null,
  source_note text
);

comment on table public.food_groups is
'Dietary classification from AESAN, "Recomendaciones dieteticas saludables y sostenibles" (December 2022). Every ingredient belongs to exactly one. The finer 13-group breakdown is used rather than that document''s coarser "at a glance" summary because serving-frequency guidance is published at this granularity.';

comment on column public.food_groups.source_note is
'Verbatim Spanish serving guidance from the source document, captured while it was being read. A source citation, NOT user-facing display text - nothing consumes it yet. A future meal-plan recommendation feature would, and can decide then whether it needs translating.';

insert into public.food_groups (code, sort_order, source_note) values
  ('hortalizas',         1,  'Al menos 3 raciones al dia de 150-200 g.'),
  ('frutas',             2,  '2-3 raciones al dia de 120-200 g.'),
  ('patatas_tuberculos', 3,  'Con moderacion. Racion: 150-200 g.'),
  ('cereales',           4,  '3-6 raciones al dia, mejor integrales. Racion: 40-60 g de pan o 60-80 g en seco de pasta o arroz.'),
  ('legumbres',          5,  'Al menos 4 raciones a la semana. Racion: 50-60 g en seco.'),
  ('frutos_secos',       6,  '3 o mas raciones a la semana. Racion: 20-30 g.'),
  ('pescado_marisco',    7,  'Al menos 3 raciones a la semana, priorizando el pescado azul. Racion: 125-150 g.'),
  ('huevos',             8,  'Maximo 4 huevos medianos a la semana.'),
  ('lacteos',            9,  'Maximo 3 raciones al dia. Racion: 200-250 ml de leche, 125 g de yogur, 85-125 g de queso fresco, 40-60 g de queso curado.'),
  ('carne',              10, 'De 0 a un maximo de 3 raciones a la semana, priorizando la carne blanca. Racion: 100-125 g.'),
  ('aceite_oliva',       11, 'Uso diario en todas las comidas. Racion: 10 ml (una cucharada sopera).'),
  ('agua',               12, 'Bebida de eleccion. Consumir siempre que se tenga sed.'),
  ('limitar',            13, 'Reducir o evitar: alimentos procesados con alto contenido en azucares, grasas y sal; mantequilla y otras grasas saturadas; sal (maximo 5 g/dia segun la OMS); bebidas azucaradas, edulcoradas y energeticas.');

-- ---------------------------------------------------------------------
-- nutrients
-- ---------------------------------------------------------------------

create table public.nutrients (
  id bigint generated always as identity primary key,
  code text not null unique,
  measure_unit text not null,
  category text not null check (category in ('macronutrient', 'vitamin', 'mineral')),
  eu_mandatory boolean not null default false,
  sort_order int not null
);

comment on table public.nutrients is
'The nutrient vocabulary of EU Regulation 1169/2011 Annex XIII. Stored as reference rows rather than as columns on an ingredient so that per-ingredient nutrition data can be sparse (most ingredients will only ever have a handful of these), and so that adding a nutrient is an insert rather than a migration. sort_order follows the declaration order the regulation prescribes.';

comment on column public.nutrients.measure_unit is
'The unit a value of this nutrient is expressed in (kJ, kcal, g, mg, ug). Deliberately NOT a foreign key to public.units: nutrient measurement units are a different vocabulary from recipe quantity units, and conflating them would permit a nutrient measured in tablespoons.';

comment on column public.nutrients.eu_mandatory is
'True for the declarations Regulation 1169/2011 requires on a label. Energy counts as one mandatory declaration but is stored as two rows (kJ and kcal), since the regulation requires it expressed in both.';

insert into public.nutrients (code, measure_unit, category, eu_mandatory, sort_order) values
  ('energy_kj',         'kJ',   'macronutrient', true,  1),
  ('energy_kcal',       'kcal', 'macronutrient', true,  2),
  ('fat',               'g',    'macronutrient', true,  3),
  ('saturates',         'g',    'macronutrient', true,  4),
  ('monounsaturates',   'g',    'macronutrient', false, 5),
  ('polyunsaturates',   'g',    'macronutrient', false, 6),
  ('carbohydrate',      'g',    'macronutrient', true,  7),
  ('sugars',            'g',    'macronutrient', true,  8),
  ('polyols',           'g',    'macronutrient', false, 9),
  ('starch',            'g',    'macronutrient', false, 10),
  ('fibre',             'g',    'macronutrient', false, 11),
  ('protein',           'g',    'macronutrient', true,  12),
  ('salt',              'g',    'macronutrient', true,  13),
  ('vitamin_a',         'ug',   'vitamin',       false, 20),
  ('vitamin_d',         'ug',   'vitamin',       false, 21),
  ('vitamin_e',         'mg',   'vitamin',       false, 22),
  ('vitamin_k',         'ug',   'vitamin',       false, 23),
  ('vitamin_c',         'mg',   'vitamin',       false, 24),
  ('thiamin',           'mg',   'vitamin',       false, 25),
  ('riboflavin',        'mg',   'vitamin',       false, 26),
  ('niacin',            'mg',   'vitamin',       false, 27),
  ('vitamin_b6',        'mg',   'vitamin',       false, 28),
  ('folic_acid',        'ug',   'vitamin',       false, 29),
  ('vitamin_b12',       'ug',   'vitamin',       false, 30),
  ('biotin',            'ug',   'vitamin',       false, 31),
  ('pantothenic_acid',  'mg',   'vitamin',       false, 32),
  ('potassium',         'mg',   'mineral',       false, 40),
  ('chloride',          'mg',   'mineral',       false, 41),
  ('calcium',           'mg',   'mineral',       false, 42),
  ('phosphorus',        'mg',   'mineral',       false, 43),
  ('magnesium',         'mg',   'mineral',       false, 44),
  ('iron',              'mg',   'mineral',       false, 45),
  ('zinc',              'mg',   'mineral',       false, 46),
  ('copper',            'mg',   'mineral',       false, 47),
  ('manganese',         'mg',   'mineral',       false, 48),
  ('fluoride',          'mg',   'mineral',       false, 49),
  ('selenium',          'ug',   'mineral',       false, 50),
  ('chromium',          'ug',   'mineral',       false, 51),
  ('molybdenum',        'ug',   'mineral',       false, 52),
  ('iodine',            'ug',   'mineral',       false, 53);

-- ---------------------------------------------------------------------
-- dietary_tags
-- ---------------------------------------------------------------------

create table public.dietary_tags (
  id bigint generated always as identity primary key,
  code text not null unique,
  category text not null check (category in ('allergen', 'diet')),
  sort_order int not null
);

comment on table public.dietary_tags is
'One vocabulary covering both the 14 allergens EU Regulation 1169/2011 Annex II requires declaring, and dietary patterns (vegetarian, vegan). They share a mechanism deliberately: both are "this ingredient carries this tag", and unifying them means a new diet type (halal, keto, low-FODMAP) is an insert rather than a migration, where boolean columns per diet would not scale. Allergen tags read as "contains X" and diet tags as "suitable for X"; that distinction lives in each tag''s meaning, not in the table structure.';

insert into public.dietary_tags (code, category, sort_order) values
  ('gluten',      'allergen', 1),
  ('crustaceans', 'allergen', 2),
  ('eggs',        'allergen', 3),
  ('fish',        'allergen', 4),
  ('peanuts',     'allergen', 5),
  ('soybeans',    'allergen', 6),
  ('milk',        'allergen', 7),
  ('nuts',        'allergen', 8),
  ('celery',      'allergen', 9),
  ('mustard',     'allergen', 10),
  ('sesame',      'allergen', 11),
  ('sulphites',   'allergen', 12),
  ('lupin',       'allergen', 13),
  ('molluscs',    'allergen', 14),
  ('vegetarian',  'diet',     100),
  ('vegan',       'diet',     101);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
--
-- Identical on all six tables, and it is the core security property of
-- this phase: readable by any signed-in user, writable by nobody.
--
-- There is deliberately no insert/update/delete policy. Under RLS the
-- ABSENCE of a policy is default-deny, so "no household can ever write to
-- the catalog" is expressed by writing no policy at all - less code than
-- granting and then restricting, and nothing to get wrong later. Writes
-- happen only through the service role (migrations and the seed script),
-- which bypasses RLS.
--
-- anon gets no policy either, so signed-out visitors read nothing.

alter table public.locales      enable row level security;
alter table public.locales      force  row level security;
alter table public.units        enable row level security;
alter table public.units        force  row level security;
alter table public.regions      enable row level security;
alter table public.regions      force  row level security;
alter table public.food_groups  enable row level security;
alter table public.food_groups  force  row level security;
alter table public.nutrients    enable row level security;
alter table public.nutrients    force  row level security;
alter table public.dietary_tags enable row level security;
alter table public.dietary_tags force  row level security;

create policy locales_select      on public.locales      for select to authenticated using (true);
create policy units_select        on public.units        for select to authenticated using (true);
create policy regions_select      on public.regions      for select to authenticated using (true);
create policy food_groups_select  on public.food_groups  for select to authenticated using (true);
create policy nutrients_select    on public.nutrients    for select to authenticated using (true);
create policy dietary_tags_select on public.dietary_tags for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- households.region_id
-- ---------------------------------------------------------------------
--
-- The only Phase 2 change to a table Phase 0/1 already built. A household
-- has a region so that seasonality data has something to be "for"; it
-- defaults to Spain and any owner can change it afterwards.
--
-- Three statements rather than one: `add column ... not null` on a table
-- with existing rows needs those rows populated first, and a column
-- DEFAULT cannot be a subquery in Postgres, so the default region is
-- resolved at insert time by create_household() below instead of being
-- declared on the column. This must run after public.regions is both
-- created AND seeded - hence its position in this same file, since a
-- backfill against an unseeded table writes NULLs and the SET NOT NULL
-- then fails.
--
-- No new RLS policy is needed: households_update is already owner-only for
-- the whole row, so "any owner may change the region, members may not" is
-- inherited from what Phase 1 built. That inheritance is asserted in
-- pgTAP rather than assumed, because behaviour nobody wrote down is the
-- kind that breaks silently when the policy is edited for another reason.

alter table public.households
  add column region_id bigint references public.regions (id);

update public.households
  set region_id = (select id from public.regions where is_default);

alter table public.households
  alter column region_id set not null;

comment on column public.households.region_id is
'Which market''s seasonal calendar applies to this household. Defaults to the region flagged is_default (Spain) at creation; changeable afterwards by any owner through the existing owner-only households_update policy.';

-- Updated only to populate the new not-null column. Everything else about
-- this function is unchanged and load-bearing: SECURITY DEFINER is
-- required because `insert ... returning` against a force-RLS table must
-- also satisfy that table's SELECT policy for the returned row, and
-- households_select requires a membership that a brand-new household
-- cannot have yet (see 20260908093000_atomic_create_household.sql for the
-- full reasoning). The signature is deliberately unchanged - creation
-- never chooses a region, so no parameter is added, and the existing
-- Phase 1 pgTAP assertions that call it keep passing untouched.
create or replace function public.create_household(_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  _household_id bigint;
begin
  insert into public.households (name, region_id)
  values (_name, (select id from public.regions where is_default))
  returning id into _household_id;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, auth.uid(), 'owner');

  return _household_id;
end;
$$;

revoke execute on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

comment on function public.create_household(text) is
'Input: _name (text) - the new household''s name.
Output: bigint - the new household''s id.
Overview: creates a household and makes the caller its first owner, atomically, assigning the default region. Both inserts happen in one transaction, so a failure partway rolls back the whole thing instead of leaving an orphaned, memberless household. SECURITY DEFINER is required here, not just a nice-to-have: insert...returning against a table with force row level security must also satisfy that table''s SELECT policy for the returned row, and households_select requires an existing membership - which a brand-new, zero-member household can never have yet. Safe because the function takes no dynamic SQL and always uses auth.uid() internally for the owner''s user_id, never a client-supplied value. Depends on exactly one public.regions row carrying is_default: without it the region subquery returns null and household creation fails the not-null constraint for every user.';
