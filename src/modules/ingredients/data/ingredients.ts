import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { NutrientCategory } from "../domain/nutrition";
import { resolveTranslation } from "../domain/translations";
import { matchesSearch } from "../domain/search";

type Client = SupabaseClient<Database>;

export type IngredientSummary = {
  code: string;
  name: string;
  /** True when `name` fell back to the default locale. */
  isFallbackName: boolean;
  foodGroupCode: string;
};

export type IngredientDetail = IngredientSummary & {
  nutritionBasis: "per_100g" | "per_100ml";
  densityGPerMl: number | null;
  gramsPerUnit: number | null;
  nutrients: Array<{
    code: string;
    measureUnit: string;
    category: NutrientCategory;
    euMandatory: boolean;
    sortOrder: number;
    amount: number;
  }>;
  dietaryTags: Array<{ code: string; category: "allergen" | "diet" }>;
  allowedUnits: Array<{ code: string; isDefault: boolean }>;
  seasonality: Array<{ regionCode: string; months: number[] }>;
};

/** Adapts the domain fallback rule to this module's row shape. */
function toName(
  translations: Array<{ locale: string; name: string }>,
  locale: string,
  defaultLocale: string,
): { name: string; isFallbackName: boolean } {
  const { name, isFallback } = resolveTranslation(translations, locale, defaultLocale);
  return { name, isFallbackName: isFallback };
}

/**
 * Lists the catalog, optionally filtered.
 *
 * One query, never N+1: translations are embedded rather than fetched per
 * ingredient. Search matching lives in `domain/search` - it runs against
 * every language the ingredient has and against its code, accent- and
 * case-insensitively.
 *
 * Retired ingredients never appear here, and that is enforced by the
 * ingredients_select policy rather than by a filter in this query - so a
 * new query somewhere else cannot forget it.
 * @param supabase A Supabase client scoped to the current request.
 * @param options Active locale, default locale, and optional filters.
 * @returns Matching ingredients, sorted by display name.
 */
export async function listIngredients(
  supabase: Client,
  options: {
    locale: string;
    defaultLocale: string;
    search?: string;
    foodGroupCode?: string;
    /**
     * Include only ingredients carrying ALL of these tag codes.
     * Inclusive on purpose - see the note below on why allergen
     * *exclusion* is a different feature rather than this one inverted.
     */
    dietaryTagCodes?: string[];
  },
): Promise<IngredientSummary[]> {
  const { locale, defaultLocale, search, foodGroupCode, dietaryTagCodes } = options;

  // `!inner` is load-bearing, not decoration. Without it PostgREST applies
  // a filter on an embedded column to the *embed* and not to the parent:
  // the request still returns every ingredient, just with food_groups set
  // to null on the ones that do not match. The filter then only appears to
  // work because a later null check drops them - which makes that null
  // check part of the filter, and therefore something a future tidy-up can
  // silently break. An inner join filters the parent rows in Postgres,
  // where it belongs.
  let query = supabase
    .from("ingredients")
    .select(
      "code, food_groups!inner(code), ingredient_translations(locale, name), ingredient_dietary_tags(dietary_tags(code))",
    );

  if (foodGroupCode) {
    query = query.eq("food_groups.code", foodGroupCode);
  }

  const { data, error } = await query;
  if (error) throw error;

  const term = search ?? "";
  const requiredTags = dietaryTagCodes?.filter(Boolean) ?? [];

  return data
    .filter((row) =>
      matchesSearch(
        term,
        row.code,
        (row.ingredient_translations ?? []).map((t) => t.name),
      ),
    )
    // Requires every selected tag, not any of them: picking "vegan" and
    // "gluten-free" together should narrow the list, which is what someone
    // combining two dietary requirements means.
    .filter((row) => {
      if (requiredTags.length === 0) return true;
      const has = new Set(
        (row.ingredient_dietary_tags ?? [])
          .map((t) => t.dietary_tags?.code)
          .filter((c): c is string => Boolean(c)),
      );
      return requiredTags.every((code) => has.has(code));
    })
    .map((row) => ({
      code: row.code,
      // No `!` needed: the inner join above makes this non-null in the
      // type as well as in fact.
      foodGroupCode: row.food_groups.code,
      ...toName(row.ingredient_translations ?? [], locale, defaultLocale),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Fetches one ingredient with everything needed to render its detail page.
 *
 * Keyed on `code`, not `id`: `code` is the ingredient's stable identity,
 * so a detail URL keeps working after the catalog is re-seeded into a
 * fresh environment, where surrogate ids would differ.
 *
 * A retired ingredient returns `null` here and so renders as not found.
 * That falls out of the ingredients_select policy rather than a filter in
 * this query - the row is simply not visible to an authenticated reader.
 * @param supabase A Supabase client scoped to the current request.
 * @param code The ingredient's stable slug.
 * @param options Active locale and default locale for name resolution.
 * @returns The ingredient, or `null` if no such code exists.
 */
export async function getIngredient(
  supabase: Client,
  code: string,
  options: { locale: string; defaultLocale: string },
): Promise<IngredientDetail | null> {
  const { data, error } = await supabase
    .from("ingredients")
    .select(
      `code, nutrition_basis, density_g_per_ml, grams_per_unit,
       food_groups(code),
       ingredient_translations(locale, name),
       ingredient_nutrients(amount, nutrients(code, measure_unit, category, eu_mandatory, sort_order)),
       ingredient_dietary_tags(dietary_tags(code, category)),
       ingredient_allowed_units(is_default, units(code)),
       ingredient_seasonality(month, regions(code))`,
    )
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.food_groups) return null;

  const seasonalityByRegion = new Map<string, number[]>();
  for (const row of data.ingredient_seasonality ?? []) {
    const regionCode = row.regions?.code;
    if (!regionCode) continue;
    const months = seasonalityByRegion.get(regionCode) ?? [];
    months.push(row.month);
    seasonalityByRegion.set(regionCode, months);
  }

  return {
    code: data.code,
    foodGroupCode: data.food_groups.code,
    ...toName(data.ingredient_translations ?? [], options.locale, options.defaultLocale),
    nutritionBasis: data.nutrition_basis as "per_100g" | "per_100ml",
    densityGPerMl: data.density_g_per_ml,
    gramsPerUnit: data.grams_per_unit,
    nutrients: (data.ingredient_nutrients ?? [])
      .filter((row) => row.nutrients !== null)
      .map((row) => ({
        code: row.nutrients!.code,
        measureUnit: row.nutrients!.measure_unit,
        category: row.nutrients!.category as NutrientCategory,
        euMandatory: row.nutrients!.eu_mandatory,
        sortOrder: row.nutrients!.sort_order,
        amount: row.amount,
      })),
    dietaryTags: (data.ingredient_dietary_tags ?? [])
      .filter((row) => row.dietary_tags !== null)
      .map((row) => ({
        code: row.dietary_tags!.code,
        category: row.dietary_tags!.category as "allergen" | "diet",
      })),
    allowedUnits: (data.ingredient_allowed_units ?? [])
      .filter((row) => row.units !== null)
      .map((row) => ({ code: row.units!.code, isDefault: row.is_default })),
    seasonality: [...seasonalityByRegion.entries()].map(([regionCode, months]) => ({
      regionCode,
      months: months.sort((a, b) => a - b),
    })),
  };
}

/**
 * Lists the food groups, for the browse filter.
 * @param supabase A Supabase client scoped to the current request.
 * @returns Group codes in the order the source document presents them.
 */
export async function listFoodGroups(supabase: Client) {
  const { data, error } = await supabase
    .from("food_groups")
    .select("code")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data.map((row) => row.code);
}

/**
 * Lists the dietary tags, for the browse filter.
 *
 * Returns the category alongside each code because the two kinds are not
 * interchangeable in a filter. Selecting a *diet* tag means "only things
 * suitable for this", which is what `listIngredients`' inclusive filter
 * does. Selecting an *allergen* almost always means the opposite -
 * "nothing containing this" - and inverting the same control silently by
 * category would be a trap. Allergen exclusion is its own feature, and
 * belongs with the household dietary-restrictions work rather than being
 * smuggled in here.
 * @param supabase A Supabase client scoped to the current request.
 * @returns Tag codes with their category, in display order.
 */
export async function listDietaryTags(supabase: Client) {
  const { data, error } = await supabase
    .from("dietary_tags")
    .select("code, category")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data.map((row) => ({
    code: row.code,
    category: row.category as "allergen" | "diet",
  }));
}
