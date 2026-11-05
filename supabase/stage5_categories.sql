-- CorkBack — category list update to the full 10. Idempotent DML (no schema
-- change). Adds the new category rows and relabels Sale -> Sales. The former
-- 'clubs'/'meetup' rows are left in place for FK safety (no live posting uses
-- them) but are not shown in the app (not in src/lib/categories.ts).

insert into public.categories (slug, label) values
  ('music',        'Music'),
  ('nightlife',    'Nightlife'),
  ('sports',       'Sports'),
  ('social-clubs', 'Social Clubs'),
  ('lost-found',   'Lost and Found'),
  ('housing',      'Housing and Real Estate'),
  ('jobs',         'Jobs'),
  ('sale',         'Sales'),
  ('classes',      'Classes'),
  ('community',    'Community')
on conflict (slug) do update set label = excluded.label;
