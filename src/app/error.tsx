"use client";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        Something went wrong
      </h2>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={() => retry()}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
      >
        Try again
      </button>
    </div>
  );
}
