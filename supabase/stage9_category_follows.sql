-- CorkBack - Stage 9 - category follows (a feed follow, not email) - REVIEW BEFORE APPLYING
--
-- Run stage9_category_follows_preflight.sql first and apply only if it matches.
--
-- Two changes, one transaction (all or nothing):
--   1. public.category_follows: one row per (user, category) the user follows.
--      Independent of alerts, follows (people) and connections. Policies mirror
--      "follows self read / write / delete": a user manages only their own rows.
--   2. profiles_username_lower_key: UNIQUE index on lower(username), so two
--      usernames can never differ only by capitalization. The existing
--      case-sensitive unique constraint stays. A guard stops the whole
--      migration, with the colliding names in the message, if the data has
--      case-insensitive duplicates. Nothing is renamed or deleted for you.
--      Building the index briefly locks writes to profiles (a small table).
--
-- Rollback: stage9_category_follows_rollback.sql.
begin;

-- Guard: refuse to add the index if existing usernames collide ignoring case.
do $$
declare
  dup text;
begin
  select string_agg(names, '; ' order by names) into dup
  from (
    select string_agg(username, ', ' order by username) as names
    from public.profiles
    group by lower(username)
    having count(*) > 1
  ) d;
  if dup is not null then
    raise exception 'Cannot add the lower(username) unique index. These usernames collide ignoring case: %. Nothing was changed.', dup;
  end if;
end $$;

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

create table if not exists public.category_follows (
  user_id      uuid     not null references public.profiles(id) on delete cascade,
  category_id  smallint not null references public.categories(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table public.category_follows enable row level security;

create policy "category_follows self read"   on public.category_follows for select using (auth.uid() = user_id);
create policy "category_follows self write"  on public.category_follows for insert with check (auth.uid() = user_id);
create policy "category_follows self delete" on public.category_follows for delete using (auth.uid() = user_id);

-- Explicit grants, so access does not depend on the project's default privileges.
-- No UPDATE: a follow is added or removed, never edited. RLS still limits rows to their owner.
grant select, insert, delete on public.category_follows to authenticated;

commit;
