import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { resolveTranslation } from "@/lib/translations";
import type { Dimension } from "../domain/scaling";
import { isBasic } from "../domain/basics";
import { matchesRecipeSearch } from "../domain/search";

type Client = SupabaseClient<Database>;

export type RecipeSummary = {
  code: string;
  title: string;
  /** True when `title` fell back to the default locale. */
  isFallbackTitle: boolean;
  tagCodes: string[];
  /** One line and no steps: an apple, a glass of milk. Hidden by default. */
  isBasic: boolean;
};

export type RecipeLine = {
  position: number;
  quantity: number;
  unitCode: string;
  dimension: Dimension;
  /** Null unless this line names a count-measured ingredient. */
  countDivisible: boolean | null;
  /** Exactly one of these two is set, enforced in the database. */
  ingredient: { code: string; name: string } | null;
  subRecipe: { code: string; title: string } | null;
};

export type RecipeDetail = {
  code: string;
  title: string;
  isFallbackTitle: boolean;
  description: string | null;
  servings: number;
  minServings: number;
  steps: Array<{ position: number; body: string }>;
  lines: RecipeLine[];
  tagCodes: string[];
  /** Derived from the ingredients, never typed by hand. */
  dietaryFacts: Array<{ code: string; category: "allergen" | "diet" }>;
};

/** Adapts the shared fallback rule to a row shape keyed by `title`. */
function toTitle(
  translations: Array<{ locale: string; title: string }>,
  locale: string,
  defaultLocale: string,
): { title: string; isFallbackTitle: boolean } {
  const { value, isFallback } = resolveTranslation(
    translations.map((t) => ({ locale: t.locale, value: t.title })),
    locale,
    defaultLocale,
  );
  return { title: value, isFallbackTitle: isFallback };
}

/**
 * Lists the recipe catalog, optionally filtered.
 *
 * One query, never N+1. Lines are embedded rather than fetched per recipe
 * because search matches on what a recipe is MADE OF as well as on its
 * name - "what can I make with chicken" is the second thing anyone tries,
 * and the answer is already in recipe_lines.
 *
 * Retired recipes never appear here, and that is enforced by the
 * recipes_select policy rather than by a filter in this query - so a new
 * query somewhere else cannot forget it.
 * @param supabase A Supabase client scoped to the current request.
 * @param options Active locale, default locale, and optional filters.
 * @returns Matching recipes, sorted by display title.
 */
export async function listRecipes(
  supabase: Client,
  options: {
    locale: string;
    defaultLocale: string;
    search?: string;
    tagCode?: string;
    /**
     * Basics - one line, no steps - are hidden unless asked for. They
     * exist so a meal plan can say "breakfast: an apple" without a second
     * concept, but a browse list where "Manzana" outnumbers "Paella"
     * is a bad list.
     */
    includeBasics?: boolean;
  },
): Promise<RecipeSummary[]> {
  const { locale, defaultLocale, search, tagCode, includeBasics } = options;

  // `!inner` on the tag join is load-bearing when a tag is selected:
  // without it PostgREST filters the EMBED rather than the parent, so
  // every recipe comes back and only the embedded tags differ. See the
  // same note in the ingredients data layer.
  const embed = tagCode
    ? "recipe_tag_assignments!inner(recipe_tags!inner(code))"
    : "recipe_tag_assignments(recipe_tags(code))";

  // `recipe_lines!recipe_id` rather than plain `recipe_lines`: a line has
  // TWO foreign keys to recipes - the recipe it belongs to and the
  // sub-recipe it may use - so the embed is ambiguous without naming the
  // column. The generated types refuse it outright rather than guessing,
  // which is the kind of mistake that would otherwise have surfaced as
  // wrong data rather than a build error.
  let query = supabase
    .from("recipes")
    .select(
      `code,
       recipe_translations(locale, title),
       recipe_steps(position),
       recipe_lines!recipe_id(position, ingredients(code, ingredient_translations(locale, name))),
       ${embed}`,
    );

  if (tagCode) {
    query = query.eq("recipe_tag_assignments.recipe_tags.code", tagCode);
  }

  const { data, error } = await query;
  if (error) throw error;

  const term = search ?? "";

  return data
    .map((row) => {
      const lines = row.recipe_lines ?? [];
      return {
        row,
        lineCount: lines.length,
        stepCount: (row.recipe_steps ?? []).length,
        ingredientCodes: lines
          .map((line) => line.ingredients?.code)
          .filter((code): code is string => Boolean(code)),
        ingredientNames: lines.flatMap((line) =>
          (line.ingredients?.ingredient_translations ?? []).map((t) => t.name),
        ),
      };
    })
    .filter((item) =>
      matchesRecipeSearch(term, {
        code: item.row.code,
        titles: (item.row.recipe_translations ?? []).map((t) => t.title),
        ingredientCodes: item.ingredientCodes,
        ingredientNames: item.ingredientNames,
      }),
    )
    .map((item) => ({
      code: item.row.code,
      ...toTitle(item.row.recipe_translations ?? [], locale, defaultLocale),
      tagCodes: (item.row.recipe_tag_assignments ?? [])
        .map((a) => a.recipe_tags?.code)
        .filter((code): code is string => Boolean(code)),
      isBasic: isBasic({ lineCount: item.lineCount, stepCount: item.stepCount }),
    }))
    // Filtered after mapping rather than in the query: "basic" is derived
    // from the shape of a recipe (one line, no steps) rather than stored,
    // which is exactly what keeps it from drifting out of sync with the
    // recipe it describes.
    .filter((recipe) => includeBasics || !recipe.isBasic)
    .sort((a, b) => a.title.localeCompare(b.title, locale));
}

/**
 * Fetches one recipe with everything needed to render its page.
 *
 * Keyed on `code`, not `id`: `code` is the recipe's stable identity, so a
 * detail URL keeps working after the catalog is re-seeded into a fresh
 * environment, where surrogate ids would differ.
 *
 * A retired recipe returns `null` here and so renders as not found. That
 * falls out of the recipes_select policy rather than a filter in this
 * query - the row is simply not visible to an authenticated reader.
 *
 * Each line carries its unit's dimension and, for a count-measured
 * ingredient, whether half of one is usable. The serving-size filter needs
 * both, and resolving them here keeps that decision a pure function of
 * already-fetched data rather than something the UI has to go and ask for.
 * @param supabase A Supabase client scoped to the current request.
 * @param code The recipe's stable slug.
 * @param options Active locale and default locale for text resolution.
 * @returns The recipe, or `null` if no such code exists.
 */
export async function getRecipe(
  supabase: Client,
  code: string,
  options: { locale: string; defaultLocale: string },
): Promise<RecipeDetail | null> {
  const { locale, defaultLocale } = options;

  const { data, error } = await supabase
    .from("recipes")
    .select(
      `id, code, servings, min_servings,
       recipe_translations(locale, title, description),
       recipe_steps(position, recipe_step_translations(locale, body)),
       recipe_lines!recipe_id(
         position, quantity,
         units(code, dimension),
         ingredients(code, count_divisible, ingredient_translations(locale, name)),
         sub_recipe:recipes!sub_recipe_id(code, recipe_translations(locale, title))
       ),
       recipe_tag_assignments(recipe_tags(code))`,
    )
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // One extra round trip rather than a hand-rolled copy of the rule: what
  // a recipe contains is derived by walking its lines down to the leaf
  // ingredients, and a second implementation of "is this vegan" in
  // TypeScript could disagree with the database's. On a detail page this
  // is one call for one recipe, not an N+1.
  const { data: facts, error: factsError } = await supabase.rpc("recipe_dietary_facts", {
    p_recipe_id: data.id,
  });
  if (factsError) throw factsError;

  const description =
    (data.recipe_translations ?? []).find((t) => t.locale === locale)?.description ??
    (data.recipe_translations ?? []).find((t) => t.locale === defaultLocale)?.description ??
    null;

  return {
    code: data.code,
    ...toTitle(data.recipe_translations ?? [], locale, defaultLocale),
    description,
    servings: data.servings,
    minServings: data.min_servings,
    steps: (data.recipe_steps ?? [])
      .map((step) => ({
        position: step.position,
        body: resolveTranslation(
          (step.recipe_step_translations ?? []).map((t) => ({
            locale: t.locale,
            value: t.body,
          })),
          locale,
          defaultLocale,
        ).value,
      }))
      .sort((a, b) => a.position - b.position),
    lines: (data.recipe_lines ?? [])
      .map((line) => ({
        position: line.position,
        quantity: line.quantity,
        unitCode: line.units?.code ?? "",
        dimension: (line.units?.dimension ?? "mass") as Dimension,
        countDivisible: line.ingredients?.count_divisible ?? null,
        ingredient: line.ingredients
          ? {
              code: line.ingredients.code,
              name: resolveTranslation(
                (line.ingredients.ingredient_translations ?? []).map((t) => ({
                  locale: t.locale,
                  value: t.name,
                })),
                locale,
                defaultLocale,
              ).value,
            }
          : null,
        subRecipe: line.sub_recipe
          ? {
              code: line.sub_recipe.code,
              title: resolveTranslation(
                (line.sub_recipe.recipe_translations ?? []).map((t) => ({
                  locale: t.locale,
                  value: t.title,
                })),
                locale,
                defaultLocale,
              ).value,
            }
          : null,
      }))
      .sort((a, b) => a.position - b.position),
    tagCodes: (data.recipe_tag_assignments ?? [])
      .map((a) => a.recipe_tags?.code)
      .filter((c): c is string => Boolean(c)),
    dietaryFacts: (facts ?? []).map((fact) => ({
      code: fact.code,
      category: fact.category as "allergen" | "diet",
    })),
  };
}

/**
 * The tag vocabulary, for the filter control.
 *
 * Reference data like nutrients and units, so it is read directly rather
 * than routed through another module's connector.
 * @param supabase A Supabase client scoped to the current request.
 * @returns Every tag code, alphabetically.
 */
export async function listRecipeTags(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.from("recipe_tags").select("code").order("code");
  if (error) throw error;
  return data.map((row) => row.code);
}
