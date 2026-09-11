import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

/**
 * Sign-in page. Server Component: redirects away immediately if already
 * signed in, otherwise renders the magic-link form, threading through any
 * `next` query param (e.g. from being redirected here off an invite link).
 * @param searchParams Next.js route props - `next` is the page/path to
 * return to after signing in, read from the URL.
 * @returns Redirects to `/` if already signed in; otherwise the sign-in
 * form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Sign in to La BonaVida
      </h1>
      <LoginForm next={next} />
    </div>
  );
}
