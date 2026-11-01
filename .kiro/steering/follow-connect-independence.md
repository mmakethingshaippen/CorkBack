---
inclusion: always
---

# Follow and Connect Independence — CorkBack

Follow and Connect are **independent systems**. Changing one never changes the other.

## Follow

- One-way. Never mutual automatically.
- Follow alone gives a **Following** view of that poster's postings.

## Connect

- A two-way friend relationship (request + accept).
- Connect alone gives **Friends attendance visibility** (who is Going / Interested).

## Independence invariants

- Accepting a Connect does **not** add a Follow.
- Following does **not** add a Connect.
- Changing one relationship never changes the other.

## Likes and plans (LOCKED)

- **Like is for postings only.** No Like on comments and no Like on replies — even though the `replies` table exists on day one. A reply/comment row SHALL NOT expose any like count or like action anywhere in the UI or API.
- **Going / Interested** are posting attendance plans.

## Replies model (confirmed)

- `replies` is a **public comment table on day one**. Replies are public comments on a posting.
- **Private messages (DMs) stay a Stage 3 stub** — the table is noted in the schema but no DM UI/API ships before Stage 3.

## Day-one data model

Even though social features ship later, the data model includes on day one:
categories, location, Follow, Connect, Like, Going, Interested, hidden postings, and public replies.
