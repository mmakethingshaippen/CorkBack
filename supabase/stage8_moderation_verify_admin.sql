-- CorkBack - Stage 8 - VERIFY (catalog) - run AFTER stage8_moderation.sql
--
-- Read-only. Every row should have pass = true.

with c (n, check_name, expected, actual) as (
  values
  (1, 'V1 postings.moderation_hidden_at exists (nullable timestamptz)', 'timestamp with time zone/YES',
     (select data_type || '/' || is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'postings' and column_name = 'moderation_hidden_at')),
  (2, 'V2 postings read policy excludes deleted AND moderated rows', 'true',
     (select (qual ilike '%deleted_at IS NULL%' and qual ilike '%moderation_hidden_at IS NULL%')::text
        from pg_policies where schemaname = 'public' and tablename = 'postings' and policyname = 'postings public read')),
  (3, 'V3 postings policies are exactly read / author insert / author edit', 'postings author edit,postings author insert,postings public read',
     (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'postings')),
  (4, 'V4 authenticated cannot update pin, expiry, deletion, moderation, author, created_at, flyer, zone, id (all false)', 'false,false,false,false,false,false,false,false,false,false',
     (select string_agg(has_column_privilege('authenticated', 'public.postings', col, 'update')::text, ',' order by ord)
        from unnest(array['lat', 'lng', 'expires_at', 'deleted_at', 'moderation_hidden_at', 'author_id', 'created_at',
                          'flyer_url', 'time_zone', 'id']) with ordinality as t(col, ord))),
  (5, 'V5 phase A: authenticated can update the content columns + is_promoted (all true; phase B removes is_promoted)', 'true,true,true,true,true,true,true,true,true,true',
     (select string_agg(has_column_privilege('authenticated', 'public.postings', col, 'update')::text, ',' order by ord)
        from unnest(array['title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time', 'end_date', 'end_time',
                          'place_label', 'is_promoted']) with ordinality as t(col, ord))),
  (51, 'V5b INSERT: authenticated may supply exactly the 15 publish-route columns (all true)', 'true,true,true,true,true,true,true,true,true,true,true,true,true,true,true',
     (select string_agg(has_column_privilege('authenticated', 'public.postings', col, 'insert')::text, ',' order by ord)
        from unnest(array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time', 'end_date', 'end_time',
                          'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at']) with ordinality as t(col, ord))),
  (52, 'V5c INSERT: authenticated may NOT supply id, created_at, is_promoted, deleted_at, moderation_hidden_at, flyer_url (all false)', 'false,false,false,false,false,false',
     (select string_agg(has_column_privilege('authenticated', 'public.postings', col, 'insert')::text, ',' order by ord)
        from unnest(array['id', 'created_at', 'is_promoted', 'deleted_at', 'moderation_hidden_at', 'flyer_url']) with ordinality as t(col, ord))),
  (53, 'V5d anon has no INSERT or UPDATE on postings', 'false,false',
     (select has_table_privilege('anon', 'public.postings', 'insert')::text || ',' || has_table_privilege('anon', 'public.postings', 'update')::text)),
  (54, 'V5e publish trigger sets created_at and preset expiry', '1',
     (select count(*)::text from pg_trigger where tgrelid = 'public.postings'::regclass and tgname = 'postings_publish_defaults' and tgenabled = 'O')),
  (6, 'V6 expiry bounded check exists and is validated', 'true',
     (select convalidated::text from pg_constraint where conrelid = 'public.postings'::regclass and conname = 'postings_expiry_bounded')),
  (7, 'V7 RLS enabled on admins, posting_reports, moderation_log, replies, postings, reply_submissions', 't,t,t,t,t,t',
     (select string_agg(case when relrowsecurity then 't' else 'f' end, ',' order by ord)
        from unnest(array['admins', 'posting_reports', 'moderation_log', 'replies', 'postings', 'reply_submissions']) with ordinality as t(rel, ord)
        join pg_class on relname = rel and relnamespace = 'public'::regnamespace)),
  (8, 'V8 anon, authenticated AND service_role have NO privileges on admins and moderation_log', 'false',
     (select bool_or(has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger'))::text
        from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['public.admins', 'public.moderation_log']) t)),
  (9, 'V9 posting_reports: no insert/update/delete/truncate for clients; reporter_id/details not selectable', 'false,false,false',
     (select has_table_privilege('authenticated', 'public.posting_reports', 'insert,update,delete,truncate')::text || ','
          || has_column_privilege('authenticated', 'public.posting_reports', 'reporter_id', 'select')::text || ','
          || has_column_privilege('authenticated', 'public.posting_reports', 'details', 'select')::text)),
  (10, 'V10 anon and service_role have no privileges on posting_reports', 'false',
     (select (has_table_privilege('anon', 'public.posting_reports', 'select,insert,update,delete,truncate')
           or has_table_privilege('service_role', 'public.posting_reports', 'select,insert,update,delete,truncate'))::text)),
  (11, 'V11 one pending report per reporter and posting (partial unique index)', 'true',
     (select (indisunique and pg_get_indexdef(indexrelid) ilike '%(posting_id, reporter_id)%' and pg_get_expr(indpred, indrelid) ilike '%pending%')::text
        from pg_index where indexrelid = 'public.posting_reports_one_pending'::regclass)),
  (12, 'V12 the 13 stage 8 security-definer functions and posting_reaction_counts all pin search_path (count missing it = 0)', '0',
     (select count(*)::text from pg_proc
       where pronamespace = 'public'::regnamespace and prosecdef
         and proname in ('is_admin', 'cb_require_admin', 'submit_posting_report', 'delete_own_posting', 'my_hidden_posting_notice', 'set_posting_promoted', 'submit_reply', 'posting_reaction_counts',
                         'admin_hide_posting', 'admin_restore_posting', 'admin_dismiss_report', 'admin_report_queue',
                         'admin_posting_detail', 'admin_moderation_log')
         and not exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%'))),
  (13, 'V13 anon cannot execute any stage 8 function except cb_has_text', 'false',
     (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('is_admin', 'cb_require_admin', 'submit_posting_report', 'delete_own_posting', 'my_hidden_posting_notice',
                           'set_posting_promoted', 'admin_hide_posting', 'admin_restore_posting', 'admin_dismiss_report', 'admin_report_queue',
                           'admin_posting_detail', 'admin_moderation_log', 'cb_posting_state', 'submit_reply',
                           'cb_moderation_log_append_only', 'cb_postings_publish_defaults'))),
  (14, 'V14 authenticated and service_role cannot execute the internal helpers', 'false,false,false,false',
     (select has_function_privilege('authenticated', 'public.cb_require_admin()', 'execute')::text || ','
          || has_function_privilege('authenticated', 'public.cb_posting_state(public.postings)', 'execute')::text || ','
          || has_function_privilege('service_role', 'public.cb_require_admin()', 'execute')::text || ','
          || has_function_privilege('service_role', 'public.cb_posting_state(public.postings)', 'execute')::text)),
  (141, 'V14b service_role cannot execute the admin functions (no API key acts as an admin)', 'false',
     (select bool_or(has_function_privilege('service_role', p.oid, 'execute'))::text from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%')),
  (15, 'V15 moderation_log append-only (UPDATE/DELETE) and no-truncate triggers present and enabled', '2',
     (select count(*)::text from pg_trigger where tgrelid = 'public.moderation_log'::regclass and tgenabled = 'O'
         and tgname in ('moderation_log_append_only', 'moderation_log_no_truncate'))),
  (16, 'V16 replies: body rule, dedupe index; policies are read + own delete only (no INSERT policy)', 'true/true/replies author delete,replies read on visible postings',
     (select exists (select 1 from pg_constraint where conrelid = 'public.replies'::regclass and conname = 'replies_body_valid')::text || '/'
          || exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'replies_client_dedupe')::text || '/'
          || (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'replies'))),
  (17, 'V17 replies: no INSERT (any column) for anon, authenticated or service_role; no UPDATE (any column) for clients', 'false,false,false,false,false',
     (select has_any_column_privilege('anon', 'public.replies', 'insert')::text || ','
          || has_any_column_privilege('authenticated', 'public.replies', 'insert')::text || ','
          || has_any_column_privilege('service_role', 'public.replies', 'insert')::text || ','
          || has_any_column_privilege('authenticated', 'public.replies', 'update')::text || ','
          || has_any_column_privilege('anon', 'public.replies', 'update')::text)),
  (171, 'V17b replies: the reply path is submit_reply(uuid,text,uuid), executable by authenticated only', 'true,false,false',
     (select has_function_privilege('authenticated', 'public.submit_reply(uuid,text,uuid)', 'execute')::text || ','
          || has_function_privilege('anon', 'public.submit_reply(uuid,text,uuid)', 'execute')::text || ','
          || has_function_privilege('service_role', 'public.submit_reply(uuid,text,uuid)', 'execute')::text)),
  (172, 'V17c reply_submissions ledger: no privileges for anon, authenticated, service_role; unique key present; no FK to replies or postings', 'false/true/0',
     (select bool_or(has_any_column_privilege(r, 'public.reply_submissions', 'select,insert,update,references')
                     or has_table_privilege(r, 'public.reply_submissions', 'select,insert,update,delete,truncate'))::text
        from unnest(array['anon', 'authenticated', 'service_role']) r) || '/'
     || exists (select 1 from pg_constraint where conrelid = 'public.reply_submissions'::regclass and conname = 'reply_submissions_once' and contype = 'u')::text || '/'
     || (select count(*)::text from pg_constraint where conrelid = 'public.reply_submissions'::regclass and contype = 'f'
           and confrelid in ('public.replies'::regclass, 'public.postings'::regclass))),
  (18, 'V18 messages/message_threads policies unchanged by stage 8 (no policy mentions admins)', '0',
     (select count(*)::text from pg_policies
       where schemaname = 'public' and tablename in ('messages', 'message_threads')
         and (coalesce(qual, '') ilike '%admin%' or coalesce(with_check, '') ilike '%admin%'))),
  (20, 'V20 posting_reaction_counts: security definer, pinned search_path, filters BOTH deleted_at and moderation_hidden_at, anon+authenticated may execute', 'true/true/true/true/true',
     (select p.prosecdef::text || '/' || (p.prosrc ilike '%deleted_at is null%')::text || '/' || (p.prosrc ilike '%moderation_hidden_at is null%')::text || '/'
          || has_function_privilege('anon', p.oid, 'execute')::text || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
        from pg_proc p where p.oid = 'public.posting_reaction_counts(uuid[])'::regprocedure)),
  (21, 'V21 moderation_log trigger function forbids changing id and manual nulling of references (definition check)', 'true',
     (select (prosrc ilike '%new.id is distinct from old.id%' and prosrc ilike '%exists (select 1 from public.postings where id = old.posting_id)%'
              and prosrc ilike '%exists (select 1 from public.posting_reports where id = old.report_id)%'
              and prosrc ilike '%exists (select 1 from public.profiles where id = old.admin_id)%')::text
        from pg_proc where oid = 'public.cb_moderation_log_append_only()'::regprocedure)),
  (22, 'V22 admin_hide_posting validates the supplied report belongs to the posting; submit_posting_report share-locks the posting (definition check)', 'true/true',
     (select (select (prosrc ilike '%report belongs to another posting%')::text from pg_proc where oid = 'public.admin_hide_posting(uuid,text,uuid)'::regprocedure) || '/'
          || (select (prosrc ilike '%for share%')::text from pg_proc where oid = 'public.submit_posting_report(uuid,public.report_reason,text)'::regprocedure))),
  (19, 'V19 the migration granted no admins (run before stage8_admin_grant.sql)', '0',
     (select count(*)::text from public.admins))
)
select n, check_name, expected, actual, coalesce(actual = expected, false) as pass from c order by n;
