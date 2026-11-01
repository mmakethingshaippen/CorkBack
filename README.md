# CorkBack

The world, posted locally. A civic board, not a social dashboard.

CorkBack turns a photo of a paper flyer into a structured posting pinned on a public local map. Anyone can browse the map and open postings with no account. An account (email only) is required to post, reply, or set up alerts.

## Status

Stage 0 complete: project skeleton, `.kiro` governance (specs, steering, hooks), build logs, license.
Stage 1 in review: the core-loop spec (requirements → design → tasks). No application features are built yet.

## Stack

- Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel
- Supabase — Postgres data + email login
- MapLibre — interactive map with free tiles
- Gemini — server-side flyer extraction only
- Resend — radius email alerts

## Kiro usage

This project is built mainly with Kiro using spec-driven development. See `.kiro/` for specs, steering docs, and hooks. See `KIRO_USAGE_LOG.md` for the running record of Kiro features used, and `BUILD_LOG.md` for the build history.

Design in Figma existed before the contest window. App code is built inside the window.

## License

MIT. See [LICENSE](./LICENSE).
