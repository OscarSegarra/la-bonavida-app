"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

/**
 * A stable empty result. Returned by every path that has nothing stored,
 * so that `getSnapshot` keeps handing React the same reference and does
 * not re-render forever.
 */
const NONE: number[] = [];

/** Fired on our own writes; the `storage` event only covers other tabs. */
const PROGRESS_EVENT = "recipe-progress";

/**
 * Last parsed value per key, so repeated reads of unchanged storage return
 * an identical array. `useSyncExternalStore` compares snapshots by
 * reference, and `JSON.parse` returns a new array every time.
 */
const cache = new Map<string, { raw: string | null; parsed: number[] }>();

/**
 * Reads a recipe's ticked steps out of `localStorage`.
 * @param key The storage key for this recipe.
 * @returns The ticked step positions, or an empty list if nothing is
 * stored, the value is unreadable, or storage itself is unavailable.
 */
function readProgress(key: string): number[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // A private window, or site data blocked. The checklist works fine
    // with no memory at all, so there is nothing to report or recover.
    return NONE;
  }

  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.parsed;

  let parsed: number[] = NONE;
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter((n) => typeof n === "number");
    } catch {
      // Something else wrote here, or it was truncated. Start clean.
      parsed = NONE;
    }
  }

  cache.set(key, { raw, parsed });
  return parsed;
}

/**
 * Writes the ticked steps and tells this tab to re-read them.
 * @param key The storage key for this recipe.
 * @param next The ticked step positions to persist.
 */
function writeProgress(key: string, next: number[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ticking still works for this visit, it just will not be remembered.
    // Failing the interaction would be worse than forgetting it.
  }
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

/**
 * Subscribes to changes from this tab and from others.
 * @param onChange Called when stored progress may have changed.
 * @returns The unsubscribe function.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(PROGRESS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PROGRESS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The instruction list, with each step tickable as it is done.
 *
 * A Client Component because ticking is interaction, not data — the
 * "specific piece that genuinely needs it" the Server-Components-first
 * rule allows for. Nothing is fetched here.
 *
 * Progress lives in `localStorage`, which reverses an earlier decision to
 * hold it in React state alone. The scenario this feature exists for is a
 * phone on a kitchen counter, where the screen sleeps and the browser
 * discards the page — losing progress exactly then would read as a bug. It
 * concedes nothing the original decision protected: still no table, no
 * RLS, no "does my partner see my ticks", device-local and self-expiring.
 *
 * `useSyncExternalStore` rather than reading storage in an effect: the
 * server has no `localStorage`, and its server snapshot is what keeps the
 * first client render identical to the server's, so hydration matches and
 * the stored state is applied immediately afterwards.
 * @param recipeCode The recipe's stable slug, used as the storage key.
 * @param steps The steps in order, already resolved to the reader's language.
 * @returns A checkbox list, or nothing at all for a recipe with no steps.
 */
export function RecipeSteps({
  recipeCode,
  steps,
}: {
  recipeCode: string;
  steps: Array<{ position: number; body: string }>;
}) {
  const t = useTranslations("Recipes");
  const storageKey = `recipe-progress:${recipeCode}`;

  const done = useSyncExternalStore(
    subscribe,
    () => readProgress(storageKey),
    () => NONE,
  );

  if (steps.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("steps")}
        </h2>
        {done.length > 0 && (
          <button
            type="button"
            onClick={() => writeProgress(storageKey, [])}
            className="text-xs text-zinc-500 underline hover:text-black dark:hover:text-zinc-50"
          >
            {t("resetSteps")}
          </button>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step) => {
          const checked = done.includes(step.position);
          return (
            <li key={step.position}>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    writeProgress(
                      storageKey,
                      checked
                        ? done.filter((p) => p !== step.position)
                        : [...done, step.position],
                    )
                  }
                  className="mt-1 size-4 shrink-0"
                />
                <span
                  className={
                    checked
                      ? "text-zinc-400 line-through dark:text-zinc-500"
                      : "text-black dark:text-zinc-50"
                  }
                >
                  <span className="mr-2 text-xs text-zinc-400">{step.position}.</span>
                  {step.body}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
