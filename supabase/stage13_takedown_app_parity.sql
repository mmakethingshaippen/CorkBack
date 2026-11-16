-- =====================================================================
-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
-- CorkBack stage 13: make public.posting_takedown_at return the same instant
-- as the app's postingTakedown (src/lib/lifecycle.ts). Safe to rerun.
-- Requires stage6_social_part1.sql (already applied). One transaction.
--
-- Found by supabase/isolated-test/takedown.mjs (design Property 15, Req 10.9):
--   1. Local end time inside a daylight saving gap or overlap. The app turns a
--      wall time into an instant with a two-pass offset lookup (wallTimeToInstant);
--      for a skipped or repeated hour that lands one hour EARLIER than Postgres'
--      `timestamp at time zone`. Example: 2024-03-10 02:19 America/New_York ->
--      app 06:19Z, database 07:19Z. Same for an event day ending at 23:59:59.999
--      when the zone falls back at midnight (America/Sao_Paulo, 2018-02-17).
--   2. end_time values the app's clock parser does not take literally: fractional
--      seconds are dropped by the app (12:00:00.5 -> 12:00:00), and 24:00 is not a
--      clock time for the app, so it uses the end of the day (23:59:59.999).
--   3. Zone strings that pass the name pattern but are not zone files. Postgres
--      reads them as POSIX rules or abbreviations (UTC+5, GMT-3, XYZ3, CEST, and
--      abbreviations that shadow a file such as CET) or accepts 'Factory'; the
--      app rejects them and falls back to Etc/GMT+12. cb_safe_time_zone now
--      falls back for these too.
-- Known limit, not fixable in SQL: names the app's runtime (ICU) accepts as
-- legacy aliases but Postgres has no zone file for (for example PST, which ICU
-- reads as America/Los_Angeles). The database falls back for them. The app
-- never stores such a name: the zone comes from tz-lookup at publish and is
-- passed through cb_safe_time_zone (src/app/api/postings/route.ts).
-- Also a known limit: CET, EET, MET, WET now fall back in the database while the
-- app reads them as zones with daylight saving; and a zone the app's tzdata has
-- but Postgres' does not. tz-lookup never returns any of these.
-- Cost: no catalog reads; names without '/' are checked against a fixed list.
-- The list was taken from pg_timezone_names on PostgreSQL 17.11 with
-- timezone_abbreviations = Default (the harness rechecks it).
-- Both functions keep their signature, return type, volatility, search_path and grants.
-- Rollback: stage13_takedown_app_parity_rollback.sql restores both stage 6 bodies.
-- =====================================================================
begin;

do $$
begin
  if to_regprocedure('public.posting_takedown_at(timestamptz,date,date,time,text)') is null
     or to_regprocedure('public.cb_safe_time_zone(text)') is null then
    raise exception 'prerequisite missing: apply stage6_social_part1.sql first';
  end if;
end $$;

create or replace function public.cb_safe_time_zone(p_tz text)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if p_tz is null or p_tz !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' or p_tz = 'Factory' then
    return 'Etc/GMT+12';
  end if;
  -- Without a '/', Postgres may read the name as an abbreviation or a POSIX rule
  -- instead of a zone file. Accept only the zone files that have no '/' (IANA adds
  -- no new names of this form), minus 'Factory' and minus CET, EET, MET and WET,
  -- where Postgres' default abbreviation (fixed offset) wins over the file (DST).
  -- A fixed list, not pg_timezone_names: that view reads every zone file (~1 s).
  if position('/' in p_tz) = 0 and not (lower(p_tz) = any (array[
       'cst6cdt', 'cuba', 'est', 'est5edt', 'egypt', 'eire', 'gb', 'gb-eire', 'gmt', 'gmt+0',
       'gmt-0', 'gmt0', 'greenwich', 'hst', 'hongkong', 'iceland', 'iran', 'israel', 'jamaica',
       'japan', 'kwajalein', 'libya', 'mst', 'mst7mdt', 'nz', 'nz-chat', 'navajo', 'prc',
       'pst8pdt', 'poland', 'portugal', 'roc', 'rok', 'singapore', 'turkey', 'uct', 'utc',
       'universal', 'w-su', 'zulu'])) then
    return 'Etc/GMT+12';
  end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'Etc/GMT+12';
end;
$$;

grant execute on function public.cb_safe_time_zone(text) to anon, authenticated;

-- wall = local end as a plain timestamp; wu = that wall clock read as UTC;
-- off(x) = zone offset at instant x. Result = wu - off(wu - off(wu)), which is
-- what wallTimeToInstant computes.
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
    (select s.wu - ((s.g at time zone s.z) - (s.g at time zone 'UTC'))
       from (select w.wu, w.z,
                    w.wu - ((w.wu at time zone w.z) - (w.wu at time zone 'UTC')) as g
               from (select (x.wall at time zone 'UTC') as wu,
                            public.cb_safe_time_zone(p_time_zone) as z
                       from (select case
                                      when p_end_time is not null and p_end_time <> time '24:00'
                                        then date_trunc('second', coalesce(p_end_date, p_event_date) + p_end_time)
                                      else coalesce(p_end_date, p_event_date) + time '23:59:59.999'
                                    end as wall) x
                      where coalesce(p_end_date, p_event_date) is not null) w) s)
  )
$$;

grant execute on function public.posting_takedown_at(timestamptz, date, date, time, text) to anon, authenticated;

commit;
