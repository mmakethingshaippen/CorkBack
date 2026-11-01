# Kiro Usage Log

One entry per Kiro feature actually used in each stage, with what it did in this project.
The final writeup is built from this log, not from memory.

---

## Stage 0 — skeleton + governance (2026-11-01)

- **Steering docs** — Created four steering docs under `.kiro/steering/`: design tokens (full Foundations palette + Kalam rules), account model, location rules, and Follow/Connect independence. These load into every Kiro interaction so the locked rules are never re-litigated screen by screen.
- **Kiro IDE** — Used the Kiro IDE in the workspace to scaffold the project and author all files directly in the editor/workspace.

## Stage 1 — core-loop spec (2026-11-01)

- **Specs (spec-driven development)** — Wrote the core-loop spec (requirements → design → tasks) before any application code. The data model, account model, categories, and location rules are set on day one in the design doc even though social features ship later. A spec-driven vs. vibe-coding comparison will be written from this build's actual experience in the final writeup.

## Stage 1 — core loop (2026-11-01)

- **Property-based testing (fast-check)** — Wrote four property suites over the locked domain rules in `src/lib/domain.ts`: (1) username validity IFF `^[A-Za-z0-9_]{3,20}$`; (2) a posting always expires after its preset, and event-date takedown is never later than preset expiry; (3) a pin always stays within the nudge bound of the poster's real location; (4) Choice B card tilt is always 2–8° and adjacent cards never mirror. **What it caught:** the pin-nudge property found an overshoot when the nudged point crossed the antimeridian (fixed by replacing naive lat/lng interpolation with a geodesic bearing+destination offset), and the card-tilt property found an off-by-one that let the magnitude reach 8.9° instead of capping at 8° (fixed the modulo range). Both were real bugs surfaced before any screen was built.
- **Agent Hooks** — `typecheck-on-save` hook (`.kiro/hooks/typecheck-on-save.json`) runs `npm run typecheck` on every `.ts/.tsx` save, catching type regressions during the build without a manual step.

> Features planned for later stages and to be logged when actually used: Kiro Powers (if it fits the stack), Custom Agents (only if a real job needs one — otherwise the writeup states none was used), MCP (only if it enables a real feature — otherwise the writeup states none was used).

### Stage 1 additions (2026-11-01)

- **Specs (spec-driven)** — The `.kiro/specs/core-loop` requirements/design/tasks drove the whole build in order. Having the day-one data model and locked choices written down first meant no screen re-litigated a rule; components were built before screens exactly as the tasks ordered. (Spec-driven vs. vibe-coding comparison for the writeup: the property tests caught two bugs that a vibe-coded version would likely have shipped, because the invariants were written as rules first.)
- **Steering docs** — The always-on steering (tokens, account model, location rules, Follow/Connect independence) was the single source of truth for every component's colors, the one-dark-red-action rule, Choice A/B, and the Like-postings-only lock.
- **Kiro IDE tool** — Used throughout to scaffold, edit, run the build/tests, and verify the running app locally. (Only Kiro IDE used so far; Kiro CLI/Web/Crew not used this stage.)
- **Web search** — Used to confirm the patched Next.js version for CVE-2025-66478 before pinning dependencies.
