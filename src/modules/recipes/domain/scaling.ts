/**
 * Working out which serving sizes a recipe can honestly be made at.
 *
 * The problem this exists to avoid: scaling a recipe by an arbitrary
 * factor produces half an egg, and no rounding rule fixes that. Rounding
 * 1.5 up to 2 changes the recipe, and printing "1,5 huevos" reads like
 * software output rather than cooking.
 *
 * So the quantities are never adjusted to fit the sizes - the sizes are
 * filtered to fit the quantities. A size is offered only when every line
 * comes out usable at that factor, and what the cook sees is always an
 * exact number.
 */

export type Dimension = "mass" | "volume" | "count";

export type ScalableLine = {
  quantity: number;
  /** Resolved by the data layer from the line's unit. */
  dimension: Dimension;
  /**
   * Whether half of one is a real thing a person can use - half an onion
   * yes, half an egg no. Null for anything not measured by count, where
   * the question does not apply.
   */
  countDivisible: boolean | null;
};

export type ScalableRecipe = {
  servings: number;
  minServings: number;
  lines: ScalableLine[];
};

/**
 * The factors worth offering. Deliberately the human ones - nobody asks
 * for 1.37× a recipe - and deliberately few, because every extra
 * candidate is another size a cook has to read past.
 */
const CANDIDATE_FACTORS = [0.5, 1, 1.5, 2, 3];

/**
 * Whether every line of this recipe survives being multiplied by a factor.
 *
 * Mass and volume never object: 75 g is 75 g at any factor. A count line
 * of a divisible ingredient may come out fractional. A count line of an
 * indivisible one must come out whole.
 * @param recipe The recipe being scaled.
 * @param factor The multiplier to test.
 * @returns True when nothing would end up unusable.
 */
function linesSurvive(recipe: ScalableRecipe, factor: number): boolean {
  return recipe.lines.every(
    (line) =>
      line.dimension !== "count" ||
      line.countDivisible === true ||
      Number.isInteger(line.quantity * factor),
  );
}

/**
 * The serving counts this recipe may be made at, smallest first.
 *
 * Always contains the recipe's own `servings`: a factor of 1 changes
 * nothing, and `min_servings` can never exceed `servings` (the database
 * enforces that), so there is always at least one size to offer.
 *
 * A recipe using a single egg for four people simply offers no smaller
 * size. That is correct and will occasionally read as a missing option -
 * it genuinely cannot be made for two without half an egg, and declining
 * is more honest than displaying 0.5.
 * @param recipe The recipe, with each line's dimension already resolved.
 * @returns Offered serving counts, ascending and free of duplicates.
 */
export function offeredSizes(recipe: ScalableRecipe): number[] {
  const sizes = CANDIDATE_FACTORS.map((factor) => ({
    factor,
    target: recipe.servings * factor,
  }))
    .filter(
      ({ factor, target }) =>
        // A recipe serves people, and there is no such thing as 4.5 of
        // them - so a factor that does not land on a whole number of
        // servings is not offered however neatly the lines divide.
        Number.isInteger(target) &&
        target >= 1 &&
        target >= recipe.minServings &&
        linesSurvive(recipe, factor),
    )
    .map(({ target }) => target);

  return [...new Set(sizes)].sort((a, b) => a - b);
}

/**
 * What one line becomes at a target number of servings.
 *
 * Returns the exact number. Nothing is rounded here: with the sizes
 * already filtered, a scaled quantity is only ever a whole number or a
 * fraction of something genuinely divisible, and rounding either would be
 * changing the recipe rather than presenting it.
 * @param quantity The line's quantity as written.
 * @param servings The recipe's own serving count.
 * @param targetServings The size being cooked, from `offeredSizes`.
 * @returns The scaled quantity.
 */
export function scaleQuantity(
  quantity: number,
  servings: number,
  targetServings: number,
): number {
  return (quantity * targetServings) / servings;
}
