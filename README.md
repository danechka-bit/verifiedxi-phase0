# VerifiedXI — Phase 0 → Phase 1 (real database)

A real, running version of the flows from the backend plan — not a mockup. The state machine, routes, and pages are plain Node.js `http` (no framework); data now lives in a real Postgres database instead of a JSON file.

## What's real vs. simulated here

**Real:** the state machine (frozen → active), the review queue, the data model, the fact that a player genuinely cannot appear in search until a guardian is approved and a season is verified. Guardian ID verification is a real Stripe Identity check when `STRIPE_SECRET_KEY` is set (see below) — Stripe's own decision flips the guardian's status, not a human clicking a button.

**Still simulated:** without a Stripe key, guardian approval falls back to a human clicking "approve" in the admin queue (so the app still runs with zero external accounts). The lff.lv stat match is always a human clicking "mark verified" after checking the link by hand — see "Why lff.lv isn't automated" below. The scout's public profile isn't actually fetched or AI-scored.

## Guardian ID verification (Stripe Identity)

Set these environment variables to turn on the real flow:

- `STRIPE_SECRET_KEY` — from your Stripe Dashboard (use a test-mode key, `sk_test_...`, while developing)
- `APP_BASE_URL` — defaults to `http://localhost:3000`; Stripe redirects the guardian back here after they complete the check
- `STRIPE_WEBHOOK_SECRET` — optional, only needed for the `/webhooks/stripe` endpoint (see below)

Without `STRIPE_SECRET_KEY` set, the guardian card just shows the old "waiting on admin" copy and nothing else changes — `identity.js`'s `isConfigured()` gate is what everything else checks.

**How it works:** when a guardian starts verification, we create a Stripe Identity `VerificationSession` and redirect to Stripe's hosted document-upload flow. When they finish, Stripe redirects back to `/guardian/:id/verify/return`, where we look up the session's result and approve or reject the guardian immediately — no admin click needed. That return-URL check is enough for testing locally. For production, also wire up the `/webhooks/stripe` endpoint (verified via `STRIPE_WEBHOOK_SECRET`) so a guardian's status still updates even if they close the tab before the redirect completes — test it locally with the Stripe CLI: `stripe listen --forward-to localhost:3000/webhooks/stripe`.

The admin queue's guardian Approve/Reject buttons still work as a manual override either way (e.g. if a session gets stuck in `requires_input`).

## Admin login

`/admin` is protected with HTTP Basic Auth. Set `ADMIN_USERNAME` (defaults to `staff`) and `ADMIN_PASSWORD` in `.env` — your browser will prompt for them the first time you visit `/admin`.

**Without `ADMIN_PASSWORD` set, `/admin` is wide open to anyone who finds the URL** — that's only acceptable for local development. Set a real password before deploying this anywhere reachable by the public.

## Player & scout accounts (passwordless login)

Players and scouts now have real accounts, gating `/player/:id`, `/scout/:id`, `/player/:id/season`, and the search page (`/scouts`) — no more trusting a numeric URL or a `?scoutId=` query param. Signup collects an email (`players.email` / `scouts.email`); the account created is auto-logged-in (a session cookie is set right away, since they just proved control of the form).

**How login works after that:** `/login` asks for an email, generates a single-use token (15-minute expiry, stored in `login_tokens`), and emails a link to `/login/verify?token=...` via [Resend](https://resend.com) when configured (see below) — otherwise the link is just shown directly on the "check your email" page for local testing, same fallback pattern as Stripe. Visiting the link creates a session (`sessions` table, 30-day expiry, `vxi_session` HttpOnly cookie) and redirects to the account's own page.

### Turning on real email delivery

Set these environment variables:

- `RESEND_API_KEY` — from your [Resend](https://resend.com) dashboard (free tier: 3,000 emails/month). Sign up, then Settings → API Keys.
- `MAIL_FROM` — optional, defaults to `VerifiedXI <onboarding@resend.dev>` (Resend's own shared testing sender — works without owning a domain yet). Once you have a real domain, verify it in Resend and switch this to something like `VerifiedXI <login@yourdomain.com>` for better deliverability and branding.

Without `RESEND_API_KEY` set, `mailer.js`'s `isConfigured()` returns false and nothing else changes — the login flow still works, just by showing the link instead of emailing it.

Ownership is enforced via `authorizeOwnerOrAdmin()` in `server.js`: a request is allowed if the session matches the resource being requested, *or* if valid admin Basic Auth is supplied (staff can always view/act on any profile for support). Anyone else gets redirected to `/login` (if not logged in at all) or a 403 (if logged in as a different account).

**Guardians still don't have their own login** — there's no separate guardian account type. But `/guardian/:id/verify` and `/guardian/:id/verify/return` are now gated the same way as everything else: only the player linked to that guardian (via `guardian_id`) can start or complete their guardian's Stripe Identity check, checked through `authorizeOwnerOrAdmin()` by looking up the owning player with `db.getPlayerByGuardian()`. Before this, anyone who knew or guessed a `guardian_id` could kick off a real Stripe verification session for it and, by completing it with their own documents, flip a stranger's child's profile to approved without the real guardian's involvement — a genuine consent-bypass, not just an information leak. It's still an imperfect model (a real guardian ideally has their own identity distinct from the child's account, not "whoever's logged in as the player"), but it closes the actual exploit with the auth infrastructure already in place.

## Career stats (Transfermarkt-style)

Season records show as a "career totals" bar (a pitch-green summary of Apps/Goals/Assists/Mins, ticker-styled like the homepage) followed by a compact table — one row per season, season label linking out to its lff.lv source — instead of a big stat-box card per season. Much more scannable once a player has more than one or two seasons on file, on both a player's own profile and in scout search results. Only *verified* seasons count toward the career total (a season still awaiting the manual lff.lv check shows in the table with its SUBMITTED badge, but doesn't inflate the trusted total). The table scrolls horizontally within its own container on narrow screens rather than breaking the page.

Deliberately did not borrow Transfermarkt's actual defining feature — market value price tags on players. Many of the people on this platform are minors; putting a valuation number on a child doesn't fit what this product is for (verified stats and guardian consent, not a market).

## Player & scout profiles: bio, photo, highlight videos

Players can set a bio and photo (pasted image URL — no upload service wired up for photos) from their own profile page, and post any number of highlight videos: either paste a YouTube/Vimeo link (parsed into a real embed by `media.js`'s `parseVideoLink`) or upload a video file directly (mp4/mov/webm/m4v, 150MB max). Scouts see all of it — photo, bio, and embedded videos — right in search results, alongside the verified stats. Scouts can set their own photo, bio, and a free-text "who are you looking for" field from their own profile page.

**Uploaded video storage is local disk (`data/uploads/videos/`) — this will NOT survive most hosting platforms.** Render, Railway, Fly.io, etc. give containers an ephemeral filesystem by default: uploaded files vanish on every redeploy or restart unless you pay for a persistent volume, which most starter tiers don't include. Before deploying, swap `media.js`'s `saveUploadedFile`/`readUploadedFile` for a real object storage upload (S3, Cloudflare R2, Cloudinary) — same swap-point pattern as `identity.js`/`mailer.js`, nothing else needs to change since callers only care about the URL that comes back. Uploaded files are saved under a random filename (the client's filename is never trusted) and validated by extension/size before being written; the serving route (`GET /uploads/videos/:filename`) only matches that exact random-hex-plus-extension pattern, so path traversal isn't reachable through it.

## Input validation

`<input required>` and friends only check what a *browser* submits — anyone can POST directly to any route with whatever they want, so every meaningful constraint is re-checked server-side in `validate.js` before data reaches `db.js`. This closed a real gap: season stats used to go through `Number(x) || 0`, which happily stored `-5` goals (any negative number is truthy) or accepted non-numeric junk as `0` with no complaint. Now: emails are checked against a basic format regex; position and scout role are checked against the same canonical lists the dropdowns offer (so POSTing an arbitrary string instead of picking from the `<select>` gets rejected, not silently stored); birth year must be a real integer in [1930, current year]; season stats must be whole numbers in sane ranges (apps 0-100, goals/assists 0-300, minutes 0-10000) if provided at all — they're optional and default to 0, but garbage isn't accepted as "close enough" to 0 anymore; bio/photo-URL/video-title fields have a length cap. A submission that fails validation never reaches `db.js` — it gets a plain "Check your input" page with the specific reason and a link back, translated the same as everything else.

This also fixed a real product bug in player signup: filling in only a guardian's name *or* only their email (not both) used to be silently treated as "no guardian," which would make an under-18 player's profile immediately ACTIVE and visible to scouts with no ID check at all. Now that combination is rejected outright.

## Scout search filters

`/scouts` used to return every verified player with no way to narrow it down — fine for a handful of test profiles, useless once there are dozens. It now has a filter form: position (the same grouped dropdown as signup), club (partial match), birth year range, and minimum goals in a season. Filters are plain GET query params (`?position=ST&club=Riga&birth_year_min=2008&min_goals=5`), so results are a shareable/bookmarkable URL, no JavaScript required. Position/club/birth-year are filtered in SQL (`db.searchablePlayers(filters)`); minimum goals is applied afterward since it's a per-season stat, not a player column — a player matches if *any* of their verified seasons clears the threshold.

## Languages

The full site is available in English, Latvian, and Russian — the `EN / LV / RU` switcher in the top-right of the nav sets a `vxi_lang` cookie (1-year expiry) and re-renders the current page in that language via `/lang/:code`; unset defaults to English. All user-facing copy (nav, forms, buttons, hints, status badges, error messages) lives in `i18n.js` as a flat `key -> string` dictionary per language with `{variable}` interpolation, looked up through `t(lang, key, vars)`. Position abbreviations (GK, CB, CDM, etc.) and internal data values (e.g. a scout's stored `role`) are intentionally *not* translated — they stay in their canonical English form regardless of UI language so the underlying data is consistent no matter which language someone signed up in; only the on-screen label changes.

Adding a fourth language means adding one more object to `i18n.js`'s `STRINGS` and one line to `LANGUAGES` — no other file needs to change. Missing keys in a language silently fall back to English rather than showing a blank or a raw key.

## Why lff.lv isn't automated

Investigated scraping lff.lv to auto-verify season stats instead of the manual admin check. Findings: the site's league/standings pages are plain server-rendered HTML with no login wall or CAPTCHA, so *scraping itself* is technically easy. But there's no individual player profile page or stable player ID anywhere on the public site — a player's full season line (apps/goals/assists/minutes) would have to be reconstructed by crawling every match report for their club and summing events by name, with no way to disambiguate two players sharing a name. That's fragile and exactly wrong for a product whose premise is verified accuracy. LFF runs a real competition system (COMET, at comet.lff.lv) with a club-facing portal — asking LFF directly about data access is a better path to automation than scraping, if that's worth pursuing later.

## Running it

Requires Node.js (16+) and a local Postgres server (e.g. [Postgres.app](https://postgresapp.com) on macOS, running on the default port 5432).

```
npm install
npm start
```

`db.js` creates the `verifiedxi` database and its tables automatically on first run — no manual migration step. Then open `http://localhost:3000`.

By default it connects to `postgres://localhost:5432/verifiedxi` with no user/password (Postgres.app's default trust-auth setup). Override with `DATABASE_URL_BASE` (e.g. `postgres://user:pass@host:5432`) and `PGDATABASE` env vars if your setup differs.

## Walking through it

1. Go to **Player signup**, create a profile for a fictional under-18 player. Note the guardian fields.
2. Visit the player's status page — it'll say **FROZEN**.
3. Go to **Admin**, approve the guardian.
4. Revisit the player's page — it's now **ACTIVE**, and a "submit a season" form appears.
5. Submit a season with an lff.lv link and some stats.
6. Back in **Admin**, "mark verified" on that season (this is the manual check step).
7. Go to **Scout signup**, create a scout account.
8. In **Admin**, approve the scout.
9. Go to **Search players** — the player now shows up with their verified stats.

## Files

- `server.js` — routes and page handlers
- `db.js` — the data layer; every "real" integration (ID verification, stat matching, scout AI check) replaces one function in here. Now backed by Postgres via the `pg` package.
- `identity.js` — Stripe Identity integration for guardian ID verification (see above)
- `mailer.js` — magic-link email delivery via Resend, with the same configured/fallback pattern as `identity.js` (see above)
- `media.js` — highlight video handling: YouTube/Vimeo link parsing and local-disk file uploads (see above — the storage swap-point before deploying)
- `i18n.js` — English/Latvian/Russian string dictionary and the `t()` lookup helper (see "Languages" above)
- `validate.js` — server-side input validation helpers (see "Input validation" above)
- `views.js` — shared HTML/CSS shell
- `data/store.json` — leftover from the Phase 0 JSON-file version; no longer read or written, safe to delete once you've confirmed the Postgres version works for you

## Where this goes next

See `verifiedxi-backend-plan.md` for the full picture. Remaining from the original plan: the lff.lv stat match stays manual for now (see above), and the scout's public profile still isn't fetched or AI-scored. For deploying beyond your own machine, point `DATABASE_URL_BASE`/`PGDATABASE` at a hosted Postgres (Supabase, Neon, Railway, RDS, etc.) instead of local Postgres.app — no code changes needed, just the connection string.
