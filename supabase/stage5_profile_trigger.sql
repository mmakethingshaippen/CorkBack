-- CorkBack Stage 5 fix — auto-create a profiles row for every new auth user.
-- Apply in the Supabase SQL editor. Idempotent.
--
-- Root cause of the live defect: the sign-up route inserted the profiles row
-- with the anon/session client, but with email confirmation ON the new user has
-- no active session at sign-up time, so RLS (auth.uid() = id) blocked the
-- insert. Result: auth user with no profile row → alerts.user_id FK fails and
-- the profile page has no username/postings.
--
-- Fix: a SECURITY DEFINER trigger on auth.users creates the profile row at the
-- moment the auth user is created, independent of any session or RLS. The
-- username is read from the sign-up metadata (raw_user_meta_data->>'username'),
-- with a safe fallback that always satisfies the username CHECK.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired text;
  candidate text;
  suffix int := 0;
begin
  -- Prefer the username supplied at sign-up; else derive a valid fallback.
  desired := nullif(trim(new.raw_user_meta_data->>'username'), '');
  if desired is null or desired !~ '^[A-Za-z0-9_]{3,20}$' then
    desired := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  candidate := desired;
  -- Ensure uniqueness without failing the auth insert.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(desired, 15) || '_' || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (new.id, candidate)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: create profile rows for any existing auth users that lack one
-- (e.g. accounts created before this trigger existed).
insert into public.profiles (id, username)
select u.id, 'user_' || substr(replace(u.id::text, '-', ''), 1, 10)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
