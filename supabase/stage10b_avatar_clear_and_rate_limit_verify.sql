-- VERIFY for stage10b_avatar_clear_and_rate_limit.sql. Run AFTER applying.
-- Everything runs inside one transaction that is ROLLED BACK at the end:
-- it changes no data. Raises an error at the first failed check; on success
-- the last statement returns 'stage10b verify: all checks passed'.
begin;

do $$
declare
  u uuid := gen_random_uuid();
  r text;
  n int;
begin
  -- Grants (same as the setup assertions).
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.cb_clear_avatar(uuid)', 'EXECUTE')
       or has_function_privilege(r, 'public.cb_avatar_rate_check(uuid)', 'EXECUTE')
       or has_function_privilege(r, 'public.cb_set_avatar(uuid,text)', 'EXECUTE') then
      raise exception 'verify failed: % can execute an avatar function', r;
    end if;
    if has_column_privilege(r, 'public.profiles', 'avatar_path', 'UPDATE')
       or has_column_privilege(r, 'public.profiles', 'avatar_path', 'INSERT') then
      raise exception 'verify failed: % can write avatar_path', r;
    end if;
    if has_table_privilege(r, 'public.avatar_uploads', 'SELECT') then
      raise exception 'verify failed: % can read avatar_uploads', r;
    end if;
  end loop;

  -- Behaviour with a temporary user and profile (rolled back below).
  insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', 'stage10b-verify@invalid.example');
  insert into public.profiles (id, username) values (u, 'zz_verify_10b')
    on conflict do nothing;
  if not exists (select 1 from public.profiles where id = u) then
    raise exception 'verify could not create its temporary profile';
  end if;

  for i in 1..5 loop perform public.cb_avatar_rate_check(u); end loop;
  begin
    perform public.cb_avatar_rate_check(u);
    raise exception 'verify failed: sixth attempt was not rate limited';
  exception when sqlstate 'CB429' then null;
  end;
  select count(*) into n from public.avatar_uploads where user_id = u;
  if n <> 5 then raise exception 'verify failed: expected 5 ledger rows, got %', n; end if;

  if public.cb_clear_avatar(u) is not null then
    raise exception 'verify failed: clear on a profile with no photo should return null';
  end if;
  begin
    perform public.cb_clear_avatar(gen_random_uuid());
    raise exception 'verify failed: unknown user was not refused';
  exception when sqlstate 'CB404' then null;
  end;
end $$;

select 'stage10b verify: all checks passed' as result;
rollback;