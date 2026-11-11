-- CorkBack - Stage 8 - TEMPORARY TEST ADMIN for browser verification (owner-only; Max runs it)
--
-- Approved use: ONE disposable verification account, admin only for the test,
-- removed afterwards. It cannot be used for a real account: it refuses any
-- username that is not a fresh disposable test account (cbsoc_admin_<6 hex>,
-- created in the last 24 hours, undeliverable or yopmail test email).
--
-- Audit entries that account creates are KEPT (they are labelled with its
-- username and "[TEST]" reasons). Only the admin grant and the account are removed.

-- 1. GRANT: replace the placeholder with the username Kiro reports, then run.
do $$
declare
  v_username constant text := 'REPLACE_WITH_TEST_USERNAME';
  v_id uuid; v_created timestamptz; v_email text;
begin
  if v_username !~ '^cbsoc_admin_[0-9a-f]{6}$' then
    raise exception 'Only a disposable cbsoc_admin_<6 hex> test account can be granted here. Nothing was changed.';
  end if;
  select p.id, u.created_at, u.email into v_id, v_created, v_email
    from public.profiles p join auth.users u on u.id = p.id
   where p.username = v_username;
  if v_id is null then raise exception 'No such test account. Nothing was changed.'; end if;
  if v_created < now() - interval '24 hours' then raise exception 'Test account is older than 24 hours. Nothing was changed.'; end if;
  if v_email !~ '^cbsoc_admin_[0-9a-f]{6}@(yopmail\.com|corkback-test\.invalid)$' then
    raise exception 'Test account email is not a disposable test address. Nothing was changed.';
  end if;
  insert into public.admins (user_id, granted_note)
  values (v_id, 'TEMPORARY stage 8 verification admin - remove after testing')
  on conflict (user_id) do nothing;
end $$;

select p.username, a.granted_at, a.granted_note
  from public.admins a join public.profiles p on p.id = a.user_id order by a.granted_at;

-- 2. REVOKE after testing (required). Run this block; expect 0 temporary admins left.
-- delete from public.admins
--  where granted_note like 'TEMPORARY stage 8 verification admin%'
--    and user_id in (select id from public.profiles where username ~ '^cbsoc_admin_[0-9a-f]{6}$');
-- select count(*) as temporary_admins_left from public.admins where granted_note like 'TEMPORARY stage 8 verification admin%';
