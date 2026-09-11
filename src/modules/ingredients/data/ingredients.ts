import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { NutrientCategory } from "../domain/nutrition";

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

/**
 * Picks the name for the requested locale, falling back to the default.
 *
 * The fallback is resolved here rather than in SQL because the query
 * fetches every translation anyway (there are at most three per
 * ingredient) and a `coalesce` across two joined copies of the same table
 * is harder to read than this for no measurable gain at catalog scale.
 */
function pickName(
  translations: Array<{ locale: string; name: string }>,
  locale: string,
  defaultLocale: string,
): { name: string; isFallbackName: boolean } {
  const exact = translations.find((t) => t.locale === locale);
  if (exact) return { name: exact.name, isFallbackName: false };

  const fallback = translations.find((t) => t.locale === defaultLocale);
  if (fallback) return { name: fallback.name, isFallbackName: true };

  // Should be unreachable: the default-locale name is required by the seed
  // validation. Degrade to something identifiable rather than throwing on
  // a read path.
  return { name: translations[0]?.name ?? "—", isFallbackName: true };
}

/**
 * Lists the catalog, optionally filtered.
 *
 * One query, never N+1: translations are embedded rather than fetched per
 * ingredient. Search runs against the requested locale's names *and* the
 * default locale's, so a Catalan speaker typing a Spanish name still finds
 * the ingredient - the catalog is only partly translated in practice.
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
  },
): Promise<IngredientSummary[]> {
  const { locale, defaultLocale, search, foodGroupCode } = options;

  let query = supabase
    .from("ingredients")
    .select("code, food_groups(code), ingredient_translations(locale, name)");

  if (foodGroupCode) {
    query = query.eq("food_groups.code", foodGroupCode);
  }

  const { data, error } = await query;
  if (error) throw error;

  const term = search?.trim().toLowerCase();

  return data
    .filter((row) => row.food_groups !== null)
    // Matching runs against every language the ingredient has, not just
    // the one being displayed: the catalog is only partly translated, so a
    // Catalan speaker typing a Spanish name should still find it.
    .filter(
      (row) =>
        !term ||
        (row.ingredient_translations ?? []).some((t) =>
          t.name.toLowerCase().includes(term),
        ),
    )
    .map((row) => ({
      code: row.code,
      foodGroupCode: row.food_groups!.code,
      ...pickName(row.ingredient_translations ?? [], locale, defaultLocale),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Fetches one ingredient with everything needed to render its detail page.
 *
 * Keyed on `code`, not `id`: `code` is the ingredient's stable identity,
 * so a detail URL keeps working after the catalog is re-seeded into a
 * fresh environment, where surrogate ids would differ.
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
    ...pickName(data.ingredient_translations ?? [], options.locale, options.defaultLocale),
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
