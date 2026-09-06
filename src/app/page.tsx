const MODULES = [
  "households",
  "recipes",
  "ingredients",
  "meal-plans",
  "shopping-lists",
] as const;

export default function Home() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-24 font-sans dark:bg-black">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          La BonaVida
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Household meal planning &amp; shopping lists.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-6 text-sm dark:border-white/10 dark:bg-zinc-900">
        <p className="font-medium text-black dark:text-zinc-50">Modules scaffolded</p>
        <ul className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
          {MODULES.map((name) => (
            <li key={name}>· {name}</li>
          ))}
        </ul>
        <p className="mt-2 font-medium text-black dark:text-zinc-50">
          Supabase connection
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          {supabaseUrl ? `Connected to ${supabaseUrl}` : "Not configured — set NEXT_PUBLIC_SUPABASE_URL"}
        </p>
      </div>
    </div>
  );
}
