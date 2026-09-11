import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Link, redirect } from "@/i18n/navigation";
import { getHousehold, getMyRole, getRoster } from "@/modules/households";

/**
 * A household's home page - name and read-only roster, with a link to
 * settings. Server Component.
 * @param params Route params - `id` is the household's numeric id, as a
 * string (from the URL), and `locale` the active language.
 * @returns A 404 (`notFound()`) if `id` isn't a valid number, the
 * household doesn't exist, or the caller isn't a member (RLS returns no
 * role for `getMyRole`, which reads the same as "doesn't exist" here -
 * deliberately, so a non-member can't distinguish "no such household"
 * from "not your household" by response shape). Redirects to `/login` if
 * signed out. Otherwise the household's name and member list.
 */
export default async function HouseholdPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const householdId = Number(id);
  if (!Number.isInteger(householdId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const [household, myRole] = await Promise.all([
    getHousehold(supabase, householdId),
    getMyRole(supabase, householdId),
  ]);
  if (!household || !myRole) notFound();

  const [roster, t, tRoles] = await Promise.all([
    getRoster(supabase, householdId),
    getTranslations("HouseholdPage"),
    getTranslations("Roles"),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {household.name}
        </h1>
        <Link
          href={`/households/${householdId}/settings`}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/10"
        >
          {t("settings")}
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("members")}
        </h2>
        <ul className="flex flex-col gap-1 text-sm text-black dark:text-zinc-50">
          {roster.map((member) => (
            <li key={member.membershipId}>
              {member.alias} · {tRoles(member.role)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
