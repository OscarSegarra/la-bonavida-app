"use client";

import { useTranslations } from "next-intl";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Common");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        {t("errorTitle")}
      </h2>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        {/*
          error.message is not translated on purpose: it comes from Postgres
          (the zero-owner guard, the invite rate limits) and is already
          phrased for a person. Translating those would mean duplicating
          every database error message into the catalogs and keeping them in
          sync with the migrations - so the fallback is translated, and the
          specific message is passed through as-is.
        */}
        {error.message || t("errorFallback")}
      </p>
      <button
        onClick={() => retry()}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}
