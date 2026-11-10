-- CorkBack - Stage 6 part 4 - PREFLIGHT (run BEFORE the migration)
--
-- Read-only: one SELECT, no writes. Save the output.
--
-- Expected (probe of 2026-11-08: 1 thread, 1 message, both pre-existing):
--   baseline   message_threads=1, messages=1 (record the actual numbers)
--   conflict   duplicate (pair, posting) threads = 0
--              messages failing the new body check = 0 (same predicate as the
--              migration; part 4 refuses to run otherwise)
--   info       messages with leading/trailing whitespace; longest message
--   info       threads with no posting (existing rows are kept as they are)
--   policy     message_threads: threads participant insert, threads participant read
--              messages: messages participant insert, messages participant read
--   grant      authenticated: insert/update/delete = true on both (table-level defaults today)
--   column     messages.client_id absent

with
baseline as (
  select 'baseline'::text as section, t.name as item, t.n::text as detail
  from (values
    ('message_threads', (select count(*) from public.message_threads)),
    ('messages',        (select count(*) from public.messages)),
    ('postings',        (select count(*) from public.postings)),
    ('profiles',        (select count(*) from public.profiles))
  ) as t(name, n)
),
conflict as (
  select 'conflict', 'duplicate threads per pair and posting (NULL posting counted as one)',
         (select count(*) from (select 1 from public.message_threads
                                group by user_lo, user_hi, coalesce(posting_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                having count(*) > 1) s)::text
  union all
  -- Exactly the migration's guard and check: 1..2000 characters with at least
  -- one character outside the shared whitespace class (tabs/newlines/Unicode
  -- spaces count as blank). Must be 0, or part 4 refuses to run.
  select 'conflict', 'messages failing the new body check (blank, whitespace-only, or >2000 chars)',
         (select count(*) from public.messages
          where not (char_length(body) between 1 and 2000
                     and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'))::text
  union all
  select 'info', 'messages with leading/trailing whitespace (allowed; app stores trimmed text)',
         (select count(*) from public.messages
          where body ~ '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
             or body ~ '[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$')::text
  union all
  select 'info', 'longest existing message (characters)', coalesce((select max(char_length(body)) from public.messages), 0)::text
  union all
  select 'info', 'threads with no posting', (select count(*) from public.message_threads where posting_id is null)::text
  union all
  select 'info', 'threads whose posting is deleted', (select count(*) from public.message_threads t
     join public.postings p on p.id = t.posting_id where p.deleted_at is not null)::text
),
pol as (
  select 'policy', p.tablename || ': ' || p.policyname,
         p.cmd || ' roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename in ('message_threads', 'messages')
),
grants as (
  select 'grant', r.rolname || ' ' || t.tbl,
         'select=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'SELECT')
         || ' insert=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'INSERT')
         || ' update=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'UPDATE')
         || ' delete=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'DELETE')
  from (values ('anon'), ('authenticated')) as r(rolname)
  cross join (values ('message_threads'), ('messages')) as t(tbl)
),
cols as (
  select 'column', 'messages.client_id',
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'messages' and column_name = 'client_id')::text
),
cons as (
  select 'constraint', cl.relname || '.' || c.conname, pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_class cl on cl.oid = c.conrelid
  where cl.relnamespace = 'public'::regnamespace and cl.relname in ('message_threads', 'messages')
)
select * from baseline
union all select * from conflict
union all select * from pol
union all select * from grants
union all select * from cols
union all select * from cons
order by 1, 2;
