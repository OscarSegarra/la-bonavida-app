-- Phase 3, slice 7a: the recipe tag vocabulary.
--
-- Seeded by a migration rather than by the recipe seed script, matching
-- how food_groups, nutrients, units, locales and dietary_tags are handled:
-- a vocabulary is reference data the schema depends on, and a dataset that
-- referenced a tag the database had never heard of should fail loudly
-- rather than quietly create one.
--
-- Deliberately small. These are the labels a person applies to a recipe -
-- when you would eat it, and how much work it is. What a recipe CONTAINS
-- is derived from its ingredients instead (20260913090000), so there are
-- no diet or allergen tags here and there never should be: a hand-applied
-- "vegan" could contradict the recipe's own ingredients.

insert into public.recipe_tags (code) values
  ('desayuno'),
  ('comida'),
  ('cena'),
  ('postre'),
  ('guarnicion'),
  ('rapido'),
  ('una_olla'),
  ('horno');

insert into public.recipe_tag_translations (tag_id, locale, name)
select t.id, v.locale, v.name
from (values
  ('desayuno',   'es', 'Desayuno'),
  ('desayuno',   'ca', 'Esmorzar'),
  ('desayuno',   'en', 'Breakfast'),
  ('comida',     'es', 'Comida'),
  ('comida',     'ca', 'Dinar'),
  ('comida',     'en', 'Lunch'),
  ('cena',       'es', 'Cena'),
  ('cena',       'ca', 'Sopar'),
  ('cena',       'en', 'Dinner'),
  ('postre',     'es', 'Postre'),
  ('postre',     'ca', 'Postres'),
  ('postre',     'en', 'Dessert'),
  ('guarnicion', 'es', 'Guarnición'),
  ('guarnicion', 'ca', 'Guarnició'),
  ('guarnicion', 'en', 'Side dish'),
  ('rapido',     'es', 'Rápido'),
  ('rapido',     'ca', 'Ràpid'),
  ('rapido',     'en', 'Quick'),
  ('una_olla',   'es', 'Una sola olla'),
  ('una_olla',   'ca', 'Una sola olla'),
  ('una_olla',   'en', 'One pot'),
  ('horno',      'es', 'Al horno'),
  ('horno',      'ca', 'Al forn'),
  ('horno',      'en', 'Oven')
) as v(code, locale, name)
join public.recipe_tags t on t.code = v.code;
