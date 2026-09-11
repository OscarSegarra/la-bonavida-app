"use client";

import { useTranslations } from "next-intl";
import type { ActionState } from "../domain/actions";

/**
 * Resolves whichever of an action's two error fields is set into a single
 * string to display.
 *
 * `errorKey` is a validation failure this app named, so it gets looked up
 * in the active locale's `Validation` catalog; `error` came back from
 * Postgres already phrased for a person and is passed through as-is. Five
 * forms need this exact rule, and getting it wrong in one of them shows a
 * raw key like "aliasTooLong" to a user - so it lives in one place.
 * @param state The state returned by a Server Action.
 * @returns The message to render, or `undefined` when there is no error.
 */
export function useActionError(state: ActionState): string | undefined {
  const t = useTranslations("Validation");
  const tCommon = useTranslations("Common");

  if (state.errorKey) return t(state.errorKey);
  if (state.error === undefined) return undefined;
  // An empty string means something non-Error was thrown and `domain/`
  // declined to invent wording for it - so supply a translated generic
  // rather than rendering a blank error line.
  return state.error || tCommon("errorFallback");
}
