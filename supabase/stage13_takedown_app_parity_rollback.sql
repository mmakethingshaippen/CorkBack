-- =====================================================================
-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
-- Rollback for stage13_takedown_app_parity.sql: restores the stage 6 bodies of
-- public.cb_safe_time_zone and public.posting_takedown_at exactly
-- (stage6_social_part1.sql). Safe to rerun.
-- =====================================================================
begin;

create or replace function public.cb_safe_time_zone(p_tz text)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if p_tz is null or p_tz !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' then
    return 'Etc/GMT+12';
  end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'Etc/GMT+12';
end;
$$;

grant execute on function public.cb_safe_time_zone(text) to anon, authenticated;

create or replace function public.posting_takedown_at(
  p_expires_at timestamptz,
  p_event_date date,
  p_end_date   date,
  p_end_time   time,
  p_time_zone  text
)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select least(
    p_expires_at,
    case
      when coalesce(p_end_date, p_event_date) is null then null
      else (coalesce(p_end_date, p_event_date)
              + coalesce(p_end_time, time '23:59:59.999'))
           at time zone public.cb_safe_time_zone(p_time_zone)
    end
  )
$$;

grant execute on function public.posting_takedown_at(timestamptz, date, date, time, text) to anon, authenticated;

commit;
