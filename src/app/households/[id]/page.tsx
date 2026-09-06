import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHousehold, getMyRole, getRoster } from "@/modules/households";

export default async function HouseholdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const householdId = Number(id);
  if (!Number.isInteger(householdId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [household, myRole] = await Promise.all([
    getHousehold(supabase, householdId),
    getMyRole(supabase, householdId),
  ]);
  if (!household || !myRole) notFound();

  const roster = await getRoster(supabase, householdId);

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
          Settings
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Members
        </h2>
        <ul className="flex flex-col gap-1 text-sm text-black dark:text-zinc-50">
          {roster.map((member) => (
            <li key={member.membershipId}>
              {member.alias} · {member.role}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
