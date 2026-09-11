export type Dimension = "mass" | "volume" | "count";

export type UnitInfo = {
  code: string;
  dimension: Dimension;
  /** Ratio to this dimension's base unit: grams, millilitres, or 1 for count. */
  toBaseFactor: number;
};

/**
 * The per-ingredient values that make a cross-dimension conversion
 * possible. Both are deliberate approximations (see the ingredients
 * migration) and both are optional, because most ingredients need
 * neither.
 */
export type Bridges = {
  densityGPerMl?: number | null;
  gramsPerUnit?: number | null;
};

/**
 * Converts a quantity between two units.
 *
 * Same-dimension conversions are pure arithmetic on the units' base
 * factors. Crossing dimensions needs the ingredient's own bridging value -
 * a density for volume↔mass, a unit weight for count→mass - and returns
 * `null` when the one it needs is missing, rather than guessing a number
 * that would silently be wrong.
 * @param amount The quantity to convert.
 * @param from The unit `amount` is expressed in.
 * @param to The unit to convert into.
 * @param bridges The ingredient's density and unit weight, if known.
 * @returns The converted amount, or `null` if the conversion needs a
 * bridging value this ingredient does not have.
 */
export function convertQuantity(
  amount: number,
  from: UnitInfo,
  to: UnitInfo,
  bridges: Bridges = {},
): number | null {
  if (!Number.isFinite(amount)) return null;

  // Everything is reduced to this dimension's base unit first, so the only
  // special case left is crossing between bases.
  const inBase = amount * from.toBaseFactor;

  if (from.dimension === to.dimension) {
    return inBase / to.toBaseFactor;
  }

  const grams = toGrams(inBase, from.dimension, bridges);
  if (grams === null) return null;

  const converted = fromGrams(grams, to.dimension, bridges);
  if (converted === null) return null;

  return converted / to.toBaseFactor;
}

/** Reduces a base-unit amount to grams, the common currency between dimensions. */
function toGrams(inBase: number, dimension: Dimension, bridges: Bridges): number | null {
  if (dimension === "mass") return inBase;
  if (dimension === "volume") {
    return bridges.densityGPerMl ? inBase * bridges.densityGPerMl : null;
  }
  return bridges.gramsPerUnit ? inBase * bridges.gramsPerUnit : null;
}

/** The inverse of `toGrams`. */
function fromGrams(grams: number, dimension: Dimension, bridges: Bridges): number | null {
  if (dimension === "mass") return grams;
  if (dimension === "volume") {
    return bridges.densityGPerMl ? grams / bridges.densityGPerMl : null;
  }
  return bridges.gramsPerUnit ? grams / bridges.gramsPerUnit : null;
}
