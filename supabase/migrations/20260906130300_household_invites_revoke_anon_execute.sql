-- Supabase grants EXECUTE on new public-schema functions to anon and
-- authenticated by default (the same pattern as the automatic table-level
-- grants) - revoking from the PUBLIC pseudo-role alone doesn't touch that
-- direct grant. Neither of these should ever be callable without a
-- session (accept_household_invite would rely on auth.uid() returning
-- null failing the not-null constraint rather than an explicit boundary,
-- which isn't good enough for this project's security-first rule).
-- Caught by Supabase's security advisor after applying the previous
-- migration - not something to leave for later.

revoke execute on function public.get_household_invite(text) from anon;
revoke execute on function public.accept_household_invite(text) from anon;
