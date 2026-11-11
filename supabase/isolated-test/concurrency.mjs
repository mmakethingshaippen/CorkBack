// Multi-session checks for stage 8. Needs REAL simultaneous database connections, so it cannot be a SQL script
// (stage8_moderation_verify_roles.sql is one transaction). Isolated database only. NEVER point this at production:
// it creates and deletes users, postings, reports and replies.
//
// Each session connects as the owner role, then does `set role authenticated` with JWT claims set the way
// PostgREST sets them, so the functions see auth.uid() and run with the same privileges as an API call.
//
// Blocking is asserted, not assumed: a session that must wait is started, and pg_blocking_pids() is polled until
// it reports the expected blocker. Only then is the blocker committed.
import crypto from "node:crypto";

export async function runConcurrency({ pg, port, owner, check, out }) {
  const S = "concurrency";
  const opened = [];

  // ---------- helpers ----------
  async function session(uid, role = "authenticated") {
    const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "iso-owner-pw", database: "postgres" });
    c.on("error", () => {});
    await c.connect();
    const claims = uid ? { sub: uid, role } : { role };
    await c.query("select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)", [JSON.stringify(claims), uid ?? ""]);
    await c.query(`set role ${role}`);
    c.pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid;
    opened.push(c);
    return c;
  }
  async function closeSessions() { for (const c of opened.splice(0)) { try { await c.query('rollback'); } catch {} try { await c.end(); } catch {} } }
  const settle = (p) => p.then((r) => ({ ok: true, rows: r.rows }), (e) => ({ ok: false, code: e.code, message: e.message }));
  const val = (res) => (res.ok ? Object.values(res.rows[0])[0] : `ERR:${res.code}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitBlockedBy(waiter, blocker, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await owner.query("select pg_blocking_pids($1) as b", [waiter.pid]);
      if (r.rows[0].b.includes(blocker.pid)) return true;
      await sleep(40);
    }
    await closeSessions();
    return false;
  }
  // true if the pending promise is still unresolved after a short grace period (i.e. it did not complete while the blocker held its lock)
  async function stillPending(promise, graceMs = 300) {
    const marker = Symbol();
    const first = await Promise.race([promise, sleep(graceMs).then(() => marker)]);
    return first === marker;
  }

  let seq = 0;
  const tag = crypto.randomBytes(3).toString("hex");
  async function mkUser(prefix) {
    const id = crypto.randomUUID(), name = `cbc_${tag}_${prefix}${++seq}`;
    await owner.query("insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())", [id, `${name}@iso.invalid`, { username: name }]);
    await owner.query("insert into public.profiles (id, username) values ($1, $2) on conflict (id) do nothing", [id, name]);
    return id;
  }
  const cat = (await owner.query("select id from public.categories order by id limit 1")).rows[0].id;
  async function mkPosting(authorId) {
    return (await owner.query("insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone) values ($1, '[CONC] posting', $2, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id", [authorId, cat])).rows[0].id;
  }
  const one = async (sql, params = []) => Object.values((await owner.query(sql, params)).rows[0])[0];
  const submitReport = (c, posting, reason = "spam_scam") => settle(c.query("select public.submit_posting_report($1, $2::public.report_reason, null)::text as r", [posting, reason]));

  const adminId = await mkUser("admin");
  await owner.query("insert into public.admins (user_id, granted_note) values ($1, 'concurrency test admin (deleted at the end)')", [adminId]);
  const createdUsers = [adminId];
  const user = async (p) => { const id = await mkUser(p); createdUsers.push(id); return id; };

  try {
    // ====================================================================================
    // 1. Reply rate limit under concurrency, deletion, and idempotent retries
    // ====================================================================================
    {
      const u = await user("rl"), author = await user("ra"), posting = await mkPosting(author);
      const sessions = await Promise.all(Array.from({ length: 24 }, () => session(u)));
      const keys = Array.from({ length: 24 }, () => crypto.randomUUID());
      const results = await Promise.all(sessions.map((c, i) => settle(c.query("select public.submit_reply($1, $2, $3)::text as r", [posting, `[CONC] reply ${i}`, keys[i]]))));
      const okN = results.filter((r) => r.ok).length, limited = results.filter((r) => !r.ok && r.code === "CB429").length, other = results.filter((r) => !r.ok && r.code !== "CB429");
      const replies = Number(await one("select count(*) from public.replies where author_id = $1", [u])), ledger = Number(await one("select count(*) from public.reply_submissions where user_id = $1", [u]));
      check(S, "24 simultaneous replies by one user: exactly 10 accepted, 14 rate limited (CB429), no other errors", okN === 10 && limited === 14 && other.length === 0 && replies === 10 && ledger === 10,
        `ok=${okN} limited=${limited} other=${other.map((x) => x.code).join(",") || "none"} replies=${replies} ledger=${ledger}`);

      // Deleting every reply does not return the allowance.
      const del = await sessions[0].query("delete from public.replies where author_id = $1", [u]);
      const again = await Promise.all(sessions.slice(0, 6).map((c) => settle(c.query("select public.submit_reply($1, '[CONC] after delete', $2)::text as r", [posting, crypto.randomUUID()]))));
      const replies2 = Number(await one("select count(*) from public.replies where author_id = $1", [u])), ledger2 = Number(await one("select count(*) from public.reply_submissions where user_id = $1", [u]));
      check(S, "after the author deletes all 10 replies, 6 more simultaneous attempts are all CB429 (ledger still 10, replies 0)", del.rowCount === 10 && again.every((r) => !r.ok && r.code === "CB429") && replies2 === 0 && ledger2 === 10,
        `deleted=${del.rowCount} results=${again.map(val).join(",")} replies=${replies2} ledger=${ledger2}`);

      // A retry of an accepted submission is answered from the ledger even at the limit: same id, nothing recreated, nothing counted.
      const firstOk = results.findIndex((r) => r.ok);
      const retry = await settle(sessions[1].query("select public.submit_reply($1, 'ignored body', $2)::text as r", [posting, keys[firstOk]]));
      const replies3 = Number(await one("select count(*) from public.replies where author_id = $1", [u])), ledger3 = Number(await one("select count(*) from public.reply_submissions where user_id = $1", [u]));
      check(S, "a retry of an accepted (now deleted) submission at the limit returns the original id, recreates nothing, counts nothing", retry.ok && val(retry) === val(results[firstOk]) && replies3 === 0 && ledger3 === 10, `retry=${val(retry)} original=${val(results[firstOk])} replies=${replies3} ledger=${ledger3}`);
    }
    await closeSessions();
    {
      // Same client_id sent by 20 sessions at once (a double-click / retry storm): one reply, one ledger row, one id for all.
      const u = await user("id"), author = await user("ia"), posting = await mkPosting(author);
      const sessions = await Promise.all(Array.from({ length: 20 }, () => session(u)));
      const key = crypto.randomUUID();
      const results = await Promise.all(sessions.map((c) => settle(c.query("select public.submit_reply($1, '[CONC] same key', $2)::text as r", [posting, key]))));
      const ids = new Set(results.map(val));
      const replies = Number(await one("select count(*) from public.replies where author_id = $1", [u])), ledger = Number(await one("select count(*) from public.reply_submissions where user_id = $1", [u]));
      check(S, "20 simultaneous submissions with the SAME client id: one reply, one ledger row, every caller gets the same id", results.every((r) => r.ok) && ids.size === 1 && replies === 1 && ledger === 1, `distinct ids=${ids.size} replies=${replies} ledger=${ledger}`);
    }
    await closeSessions();
    {
      // 12 distinct keys, each sent twice at once, against a limit of 10: 10 keys accepted (both copies return one id), 2 keys refused.
      const u = await user("mx"), author = await user("ma"), posting = await mkPosting(author);
      const sessions = await Promise.all(Array.from({ length: 24 }, () => session(u)));
      const keys = Array.from({ length: 12 }, () => crypto.randomUUID());
      const results = await Promise.all(sessions.map((c, i) => settle(c.query("select public.submit_reply($1, '[CONC] mixed', $2)::text as r", [posting, keys[i % 12]]))));
      const byKey = new Map();
      results.forEach((r, i) => { const k = keys[i % 12]; (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r); });
      const acceptedKeys = [...byKey.values()].filter((rs) => rs.every((r) => r.ok) && new Set(rs.map(val)).size === 1).length;
      const refusedKeys = [...byKey.values()].filter((rs) => rs.every((r) => !r.ok && r.code === "CB429")).length;
      const replies = Number(await one("select count(*) from public.replies where author_id = $1", [u])), ledger = Number(await one("select count(*) from public.reply_submissions where user_id = $1", [u]));
      check(S, "12 keys x 2 simultaneous copies against the limit of 10: 10 keys accepted once each, 2 refused, duplicates never counted twice", acceptedKeys === 10 && refusedKeys === 2 && replies === 10 && ledger === 10, `accepted keys=${acceptedKeys} refused keys=${refusedKeys} replies=${replies} ledger=${ledger}`);
    }
    await closeSessions();

    // ====================================================================================
    // 2. Report rate limit and duplicate suppression under concurrency
    // ====================================================================================
    {
      const r = await user("rr"), author = await user("ra2");
      const postings = [];
      for (let i = 0; i < 12; i++) postings.push(await mkPosting(author));
      const sessions = await Promise.all(postings.map(() => session(r)));
      const results = await Promise.all(sessions.map((c, i) => submitReport(c, postings[i])));
      const created = results.filter((x) => val(x) === "created").length, limited = results.filter((x) => !x.ok && x.code === "CB429").length;
      const rows = Number(await one("select count(*) from public.posting_reports where reporter_id = $1", [r]));
      check(S, "12 simultaneous reports by one reporter on 12 postings: exactly 5 created, 7 rate limited (CB429)", created === 5 && limited === 7 && rows === 5, `created=${created} limited=${limited} rows=${rows}`);

      const r2 = await user("rd"), p = await mkPosting(author);
      const s2 = await Promise.all(Array.from({ length: 8 }, () => session(r2)));
      const res2 = await Promise.all(s2.map((c) => submitReport(c, p)));
      const c2 = res2.filter((x) => val(x) === "created").length, dup = res2.filter((x) => val(x) === "already_reported").length;
      const rows2 = Number(await one("select count(*) from public.posting_reports where reporter_id = $1 and posting_id = $2", [r2, p]));
      check(S, "8 simultaneous reports of the same posting by one reporter: 1 created, 7 already_reported, 1 row", c2 === 1 && dup === 7 && rows2 === 1, `created=${c2} dup=${dup} rows=${rows2}`);
    }
    await closeSessions();

    // ====================================================================================
    // 3. Report vs hide / delete: no report can be added after the posting becomes unavailable
    // ====================================================================================
    const hideSql = "select public.admin_hide_posting($1, '[CONC] hide', null)::text as r";
    {
      // 3a. Hide in progress (uncommitted): the reporter must WAIT, then be refused.
      const author = await user("ha"), rep = await user("hr"), p = await mkPosting(author);
      const admin = await session(adminId), reporter = await session(rep);
      await admin.query("begin");
      const hidden = await settle(admin.query(hideSql, [p]));
      const pending = submitReport(reporter, p);
      const blocked = await waitBlockedBy(reporter, admin);
      const stillWaiting = await stillPending(pending);
      await admin.query("commit");
      const res = await pending;
      const reports = Number(await one("select count(*) from public.posting_reports where posting_id = $1", [p]));
      check(S, "report started while an admin hide is uncommitted: the reporter waits for the hide, then is refused (CB404); no report row", hidden.ok && val(hidden) === "hidden" && blocked && stillWaiting && val(res) === "ERR:CB404" && reports === 0,
        `hide=${val(hidden)} blockedByAdmin=${blocked} waited=${stillWaiting} reporter=${val(res)} reports=${reports}`);
    }
    await closeSessions();
    {
      // 3b. Report in progress (uncommitted): the hide must wait, then it sees and resolves that report.
      const author = await user("ha"), rep = await user("hr"), p = await mkPosting(author);
      const admin = await session(adminId), reporter = await session(rep);
      await reporter.query("begin");
      const created = await submitReport(reporter, p);
      const pendingHide = settle(admin.query(hideSql, [p]));
      const blocked = await waitBlockedBy(admin, reporter);
      const stillWaiting = await stillPending(pendingHide);
      await reporter.query("commit");
      const res = await pendingHide;
      const st = (await owner.query("select status::text, resolved_by from public.posting_reports where posting_id = $1", [p])).rows;
      check(S, "hide started while a report is uncommitted: the hide waits for the report, then resolves it (no pending report left on a hidden posting)", val(created) === "created" && blocked && stillWaiting && val(res) === "hidden" && st.length === 1 && st[0].status === "actioned" && st[0].resolved_by === adminId,
        `report=${val(created)} blockedByReporter=${blocked} waited=${stillWaiting} hide=${val(res)} reportStatus=${st.map((x) => x.status).join(",")}`);
    }
    await closeSessions();
    {
      // 3c. Author delete in progress (uncommitted): the reporter waits, then is refused.
      const author = await user("da"), rep = await user("dr"), p = await mkPosting(author);
      const owner1 = await session(author), reporter = await session(rep);
      await owner1.query("begin");
      const del = await settle(owner1.query("select public.delete_own_posting($1)::text as r", [p]));
      const pending = submitReport(reporter, p);
      const blocked = await waitBlockedBy(reporter, owner1);
      const stillWaiting = await stillPending(pending);
      await owner1.query("commit");
      const res = await pending;
      const reports = Number(await one("select count(*) from public.posting_reports where posting_id = $1", [p]));
      check(S, "report started while the author's delete is uncommitted: the reporter waits, then is refused (CB404); no report row", val(del) === "deleted" && blocked && stillWaiting && val(res) === "ERR:CB404" && reports === 0,
        `delete=${val(del)} blocked=${blocked} waited=${stillWaiting} reporter=${val(res)} reports=${reports}`);
    }
    await closeSessions();
    {
      // 3d. Report in progress (uncommitted): the author's delete waits for it (the report was legitimately made while the posting was available).
      const author = await user("da"), rep = await user("dr"), p = await mkPosting(author);
      const owner1 = await session(author), reporter = await session(rep);
      await reporter.query("begin");
      const created = await submitReport(reporter, p);
      const pendingDel = settle(owner1.query("select public.delete_own_posting($1)::text as r", [p]));
      const blocked = await waitBlockedBy(owner1, reporter);
      const stillWaiting = await stillPending(pendingDel);
      await reporter.query("commit");
      const res = await pendingDel;
      check(S, "delete started while a report is uncommitted: the delete waits for the report, then completes", val(created) === "created" && blocked && stillWaiting && val(res) === "deleted", `report=${val(created)} blocked=${blocked} waited=${stillWaiting} delete=${val(res)}`);
    }
    await closeSessions();
    {
      // 3e. Hide wins, then a LATE report (after commit) is refused too (ordinary, non-concurrent).
      const author = await user("la"), rep = await user("lr"), p = await mkPosting(author);
      const admin = await session(adminId), reporter = await session(rep);
      const h = await settle(admin.query(hideSql, [p]));
      const late = await submitReport(reporter, p);
      check(S, "a report after the hide has committed is refused (CB404)", val(h) === "hidden" && val(late) === "ERR:CB404", `hide=${val(h)} late=${val(late)}`);
    }
    await closeSessions();

    // ====================================================================================
    // 4. Dismiss vs hide: same lock order, no deadlock
    // ====================================================================================
    {
      // 4a. Dismiss in progress: the hide waits, then hides and leaves the dismissed report dismissed.
      const author = await user("xa"), r1 = await user("x1"), r2 = await user("x2"), p = await mkPosting(author);
      const a1 = await session(adminId), a2 = await session(adminId);
      const s1 = await session(r1), s2 = await session(r2);
      await submitReport(s1, p); await submitReport(s2, p);
      const rep1 = await one("select id from public.posting_reports where posting_id = $1 and reporter_id = $2", [p, r1]);
      await a1.query("begin");
      const dis = await settle(a1.query("select public.admin_dismiss_report($1, '[CONC] dismiss')::text as r", [rep1]));
      const pendingHide = settle(a2.query(hideSql, [p]));
      const blocked = await waitBlockedBy(a2, a1);
      await a1.query("commit");
      const res = await pendingHide;
      const st = (await owner.query("select status::text from public.posting_reports where posting_id = $1 order by reporter_id = $2 desc", [p, r1])).rows.map((x) => x.status).join(",");
      check(S, "hide started while a dismissal is uncommitted: the hide waits, then hides; dismissed stays dismissed, the other report is actioned", val(dis) === "dismissed" && blocked && val(res) === "hidden" && st === "dismissed,actioned", `dismiss=${val(dis)} blocked=${blocked} hide=${val(res)} statuses=${st}`);
    }
    await closeSessions();
    {
      // 4b. Hide in progress: the dismissal waits for the posting lock, then finds the report already actioned.
      const author = await user("xa"), r1 = await user("x1"), p = await mkPosting(author);
      const a1 = await session(adminId), a2 = await session(adminId), s1 = await session(r1);
      await submitReport(s1, p);
      const rep1 = await one("select id from public.posting_reports where posting_id = $1", [p]);
      await a1.query("begin");
      const h = await settle(a1.query(hideSql, [p]));
      const pendingDis = settle(a2.query("select public.admin_dismiss_report($1, null)::text as r", [rep1]));
      const blocked = await waitBlockedBy(a2, a1);
      await a1.query("commit");
      const res = await pendingDis;
      check(S, "dismissal started while a hide is uncommitted: the dismissal waits, then answers not_pending", val(h) === "hidden" && blocked && val(res) === "not_pending", `hide=${val(h)} blocked=${blocked} dismiss=${val(res)}`);
    }
    await closeSessions();

    // ====================================================================================
    // 5. Stress: hide / dismiss x2 / report / author delete / restore fired together, many rounds. No deadlock, invariant holds.
    // ====================================================================================
    {
      const ROUNDS = 12, errors = [], violations = [];
      const author = await user("sa");
      const pool = await Promise.all(Array.from({ length: 4 }, () => session(adminId)));
      for (let round = 0; round < ROUNDS; round++) {
        const p = await mkPosting(author);
        const r1 = await user("s1"), r2 = await user("s2"), r3 = await user("s3");
        const c1 = await session(r1), c2 = await session(r2);
        await submitReport(c1, p); await submitReport(c2, p);
        const ids = (await owner.query("select id from public.posting_reports where posting_id = $1 order by created_at, id", [p])).rows.map((x) => x.id);
        const sa = await session(author), s3 = await session(r3);
        const ops = [
          settle(pool[0].query(hideSql, [p])),
          settle(pool[1].query("select public.admin_dismiss_report($1, null)::text as r", [ids[0]])),
          settle(pool[2].query("select public.admin_dismiss_report($1, null)::text as r", [ids[1]])),
          submitReport(s3, p),
          ...(round % 2 ? [settle(sa.query("select public.delete_own_posting($1)::text as r", [p]))] : []),
          settle(pool[3].query("select public.admin_restore_posting($1, '[CONC] restore')::text as r", [p])),
        ];
        const res = await Promise.all(ops);
        for (const x of res) if (!x.ok && ["40P01", "40001", "55P03"].includes(x.code)) errors.push(x.code);
        // Invariant: a posting that is hidden at the end has no pending report. (Restore may have un-hidden it; then nothing to check.)
        const bad = (await owner.query("select count(*)::int n from public.posting_reports r join public.postings p on p.id = r.posting_id where p.id = $1 and p.moderation_hidden_at is not null and r.status = 'pending'", [p])).rows[0].n;
        if (bad) violations.push(round);
        for (const c of [c1, c2, sa, s3]) await c.end().catch(() => {});
      }
      check(S, `${ROUNDS} rounds of hide / 2 dismissals / report / author delete / restore fired together: no deadlock or serialization error; no pending report on a hidden posting`, errors.length === 0 && violations.length === 0,
        `deadlock/serialization errors=${errors.length} violations=${violations.join(",") || "none"}`);
    }
    await closeSessions();
  } finally {
    for (const c of opened) { try { await c.query("rollback"); } catch {} try { await c.end(); } catch {} }
    // Cleanup (as owner). Audit rows by the concurrency admin are kept by design (append-only); their links become null.
    await owner.query("delete from auth.users where id = any($1::uuid[])", [createdUsers]);
    const left = (await owner.query("select (select count(*) from public.profiles where username like $1) as p, (select count(*) from public.admins where granted_note like 'concurrency test admin%') as a", [`cbc\\_${tag}\\_%`])).rows[0];
    check(S, "cleanup: no concurrency test accounts or admin grant left", Number(left.p) === 0 && Number(left.a) === 0, JSON.stringify(left));
  }
}
