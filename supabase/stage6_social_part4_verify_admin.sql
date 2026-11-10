-- CorkBack - Stage 6 part 4 - VERIFY (ADMIN) - run AFTER the migration
-- Catalog checks only; read-only. Result: pass = true / false / null (info).

with checks(n, check_name, expected, actual) as (
  values
  (1, 'D1 thread policies are exactly the reviewed set',
   'threads participant read SELECT | threads start with posting author INSERT',
   (select string_agg(policyname || ' ' || cmd, ' | ' order by policyname collate "C")
    from pg_policies where schemaname = 'public' and tablename = 'message_threads')),
  (2, 'D2 message policies unchanged (participant read/insert only)',
   'messages participant insert INSERT | messages participant read SELECT',
   (select string_agg(policyname || ' ' || cmd, ' | ' order by policyname collate "C")
    from pg_policies where schemaname = 'public' and tablename = 'messages')),
  (3, 'D3 thread start requires a non-deleted posting authored by the other participant', 'true',
   (select (with_check ilike '%posting_id IS NOT NULL%' and with_check ilike '%deleted_at IS NULL%'
            and with_check ilike '%author_id <> auth.uid()%')::text
    from pg_policies where schemaname = 'public' and tablename = 'message_threads' and policyname = 'threads start with posting author')),
  (4, 'D4 one thread per pair per posting (existing unique key)', '1',
   (select count(*)::text from pg_constraint
    where conrelid = 'public.message_threads'::regclass and conname = 'threads_unique_pair_posting' and contype = 'u')),
  (5, 'D5 messages.client_id exists (uuid, nullable)', 'uuid YES',
   (select data_type || ' ' || is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'client_id')),
  (6, 'D6 unique (thread_id, sender_id, client_id)', 'true',
   (select (count(*) = 1)::text from pg_indexes
    where schemaname = 'public' and tablename = 'messages' and indexname = 'messages_client_dedupe'
      and indexdef ilike 'CREATE UNIQUE INDEX%(thread_id, sender_id, client_id)%')),
  (7, 'D7 body check: 1..2000 chars and not whitespace-only (shared class incl. tab/newline/Unicode spaces)', 'true',
   (select (count(*) = 1
            -- strpos, not LIKE: in LIKE a backslash is the escape character.
            and bool_and(strpos(pg_get_constraintdef(oid), 'char_length(body)') > 0
                         and strpos(pg_get_constraintdef(oid), '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]') > 0))::text
    from pg_constraint
    where conrelid = 'public.messages'::regclass and conname = 'messages_body_valid')),
  (8, 'D8 authenticated messages: column insert only; no table insert/update/delete',
   'tbl ins=false upd=false del=false | col thread=true sender=true body=true client=true created_at=false id=false',
   'tbl ins=' || has_table_privilege('authenticated', 'public.messages', 'INSERT')
   || ' upd=' || has_table_privilege('authenticated', 'public.messages', 'UPDATE')
   || ' del=' || has_table_privilege('authenticated', 'public.messages', 'DELETE')
   || ' | col thread=' || has_column_privilege('authenticated', 'public.messages', 'thread_id', 'INSERT')
   || ' sender=' || has_column_privilege('authenticated', 'public.messages', 'sender_id', 'INSERT')
   || ' body=' || has_column_privilege('authenticated', 'public.messages', 'body', 'INSERT')
   || ' client=' || has_column_privilege('authenticated', 'public.messages', 'client_id', 'INSERT')
   || ' created_at=' || has_column_privilege('authenticated', 'public.messages', 'created_at', 'INSERT')
   || ' id=' || has_column_privilege('authenticated', 'public.messages', 'id', 'INSERT')),
  (9, 'D9 authenticated threads: column insert only; no table insert/update/delete',
   'tbl ins=false upd=false del=false | col posting=true lo=true hi=true created_at=false id=false',
   'tbl ins=' || has_table_privilege('authenticated', 'public.message_threads', 'INSERT')
   || ' upd=' || has_table_privilege('authenticated', 'public.message_threads', 'UPDATE')
   || ' del=' || has_table_privilege('authenticated', 'public.message_threads', 'DELETE')
   || ' | col posting=' || has_column_privilege('authenticated', 'public.message_threads', 'posting_id', 'INSERT')
   || ' lo=' || has_column_privilege('authenticated', 'public.message_threads', 'user_lo', 'INSERT')
   || ' hi=' || has_column_privilege('authenticated', 'public.message_threads', 'user_hi', 'INSERT')
   || ' created_at=' || has_column_privilege('authenticated', 'public.message_threads', 'created_at', 'INSERT')
   || ' id=' || has_column_privilege('authenticated', 'public.message_threads', 'id', 'INSERT')),
  (10, 'D10 anon has no write privileges on threads or messages', 'false,false,false,false,false,false',
   has_table_privilege('anon', 'public.messages', 'INSERT') || ',' || has_table_privilege('anon', 'public.messages', 'UPDATE') || ','
   || has_table_privilege('anon', 'public.messages', 'DELETE') || ',' || has_table_privilege('anon', 'public.message_threads', 'INSERT') || ','
   || has_table_privilege('anon', 'public.message_threads', 'UPDATE') || ',' || has_table_privilege('anon', 'public.message_threads', 'DELETE')),
  (11, 'D11 RLS enabled on both tables', 'message_threads=true,messages=true',
   (select string_agg(relname || '=' || relrowsecurity, ',' order by relname collate "C")
    from pg_class where relnamespace = 'public'::regnamespace and relname in ('message_threads', 'messages'))),
  (12, 'D12 info: totals (compare with preflight; existing rows kept)', null,
   'message_threads=' || (select count(*) from public.message_threads) || ' messages=' || (select count(*) from public.messages)
   || ' messages_with_client_id=' || (select count(*) from public.messages where client_id is not null))
)
select n, check_name, expected, actual,
       case when expected is null then null else expected is not distinct from actual end as pass
from checks order by n;
