-- CorkBack - Stage 8 PHASE B - promotion only through set_posting_promoted() - REVIEW BEFORE APPLYING
--
-- Apply ONLY AFTER the new code is in production. The new code promotes through
-- public.set_posting_promoted(); the old deployed code (6289a7e) updated
-- postings.is_promoted directly and would stop working after this.
--
-- After this, authenticated users can UPDATE only: title, body, category_id,
-- rsvp_url, event_date, event_time, end_date, end_time, place_label.
-- Rollback: the commented block at the end (only if the app is reverted to code
-- that updates is_promoted directly).

begin;
revoke update (is_promoted) on public.postings from anon, authenticated;
commit;

-- Check: expect false / true / true.
select has_column_privilege('authenticated', 'public.postings', 'is_promoted', 'update') as clients_can_set_promotion_directly,
       has_column_privilege('authenticated', 'public.postings', 'title', 'update') as clients_can_still_edit_content,
       has_function_privilege('authenticated', 'public.set_posting_promoted(uuid, boolean)', 'execute') as promotion_function_available;

-- ROLLBACK (re-opens direct is_promoted updates by the author; only for reverted code):
-- grant update (is_promoted) on public.postings to authenticated;
