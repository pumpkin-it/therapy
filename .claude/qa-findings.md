# QA findings (shared between threads/agents)

Shared log of problems found while running `.claude/regression-checklist.md`. Any thread or agent
may read it, fix items, and mark them fixed. **Always update this file when you find, fix or
re-test something**, and commit it so other threads see it.

Status values: `open` · `fixed` (add commit/date) · `wontfix` (add reason) · `unverified`.

## Findings

| # | Status | Severity | Finding | Where |
|---|--------|----------|---------|-------|
| 1 | open | high (security) | `GET /api/practitioners` returns every user's `password_hash` and `cal_token`. Seen as owner; route is open to `users`/`invoices`/`calendar` permission, so lower roles likely get them too (not tested). Use an explicit column list. | `server/routes/practitioners.js:13` |
| 2 | open | medium | `PATCH /api/appointments/:id` is a full replace. Omitting `practitioner_id` or `client_id` hits a NOT NULL constraint and returns 500. Should validate (400) or keep existing values. | `server/routes/appointments.js:204` |
| 3 | open | low | `/favicon.ico` returns 404 on every page. | `client/index.html`, `client/public` |
| 4 | unverified | low | After "Create client" the URL was still `/clients/new` 1.5s later, though the client was created. Not confirmed whether it never redirects to the new client's profile. | `client/src/pages/ClientDetail.jsx` |
| 5 | open | low | Fresh install: appointment modal lists only `role=practitioner` users; the default admin is `owner`, so the practitioner dropdown is empty with no hint. | `client/src/components/AppointmentModal.jsx:897` |
| 6 | open | low | Fresh install has no `cancellation_policy` setting, so late-cancel prompts never appear until one is set. May be intended. | `server/database.js` (settings seed) |
| 7 | open | low (security) | Empty DB auto-creates `admin@practice.com` / `admin123`. Make sure this can't happen on a real deploy. | `server/database.js:483-502` |
| 8 | open | low | No `DELETE /api/appointments/:id` route, so QA/test appointments can't be cleaned up via the API. | `server/routes/appointments.js` |
| 9 | open | docs | Checklist mentions a "Claude Browser pane" tool that cloud sessions don't have; item 1 says "Save" but the button is "Create client". | `.claude/regression-checklist.md` |
| 10 | open | medium | **Month view hides the session-note icon.** The icon is rendered at the end of a `truncate` line (`09:00 am–10:00 am QA Smoke <icon>`), so at normal widths the text pushes it out of sight. The practice uses this icon to audit that every session has notes; Day and Week views show it correctly. Move the icon before the text or out of the truncated span. | `client/src/components/CalendarViews.jsx:413` |
| 11 | open | low | Settings page logs a 404 console error (`/api/settings/logo`) whenever no logo is set (e.g. fresh install). Return 204/empty or skip the request. | `server/routes/settings.js:36` |
| 12 | open | low (cosmetic) | Week view: a back-to-back appointment's "Travel" strip overlaps the next block's title (client name looks struck through). | `client/src/components/CalendarViews.jsx` |
| 13 | unverified | low | Day view colours appointment blocks light blue, while Week/Month use the practitioner colour (rose). May be intentional. | `client/src/components/CalendarViews.jsx:~230` |
| 14 | info | - | A billed late cancellation (LC) stays visible on the normal calendar; a plain cancellation (C) is hidden. Probably by design; the checklist should say so. | `CalendarViews.jsx` |
| 15 | info | - | Billing rounds quantities to 2 dp (`roundQty`), so 20 min travel bills as 0.33 h = $19.80, not $20.00. Deliberate, but worth knowing when checking amounts. | `client/src/lib/utils.js:7` |
| 16 | open | docs | Checklist drift: item 4's "known tool limitation" is outdated (the no-fee cancel now uses a custom in-app confirm, so it IS automatable); the late-cancel prompt buttons are "Apply N% late cancellation fee / Cancel without fee (override) / Go back" (decline = override, not Go back); the notes list shows a plain-text preview until a note is opened; Edit is a pencil icon; reloading a page with an open appointment reopens it via deep link. | `.claude/regression-checklist.md` |

## Checklist run log

Local run (fresh DB seeded with a QA client, QA practitioner, services, a rate period and a
cancellation policy; UAT host is blocked by the environment network policy, so UAT was NOT tested).
All UI checks driven with Playwright against the local app. Nothing was emailed or exported.

| Item | Result | Notes |
|------|--------|-------|
| 1 Add client + duplicate warning | PASS | Client listed; "Possible duplicate" banner shown (finding 4 unverified: redirect after create) |
| 2 Book appointment | PASS | Right time/day/colour, service description on block (Day/Week/Month), double-booking warning shown, session-note icon appears in Day and Week only (finding 10) |
| 3 Edit appointment | PASS | Time + service change persisted (verified via API after reload) |
| 4 Cancel outside window | PASS | Custom confirm popup appears, plain "C" badge on cancelled-only view, hidden from normal view |
| 5 Late cancellation | PASS | Prompt shows tier and notice; billed = "LC" badge and To Send row "Cancelled - billable 100%" $139.80 (fee + travel/km/notes intact); unbilled = "C" badge and excluded from To Send |
| 6 Session notes | PASS | Note added in modal shows on client profile with the appointment date; draft recovery works, Cancel and Save clear it; standalone note can be linked via picker; bold/list/picture persist and Edit reopens intact. NOT covered: Use template, colour/font, old Quill notes |
| 7 Note PDF / email | PASS | PDF 200, correct date, formatted content, footer "Page 1 of 1"; email modal pre-filled correctly (not sent). NOT covered: multi-page/page-break, picture in PDF |
| 8 Forms | not run | no form templates on a fresh DB |
| 9 Invoicing | PASS | To Send row shows line total $139.80, row select works ("Generate 1 invoice"); Generate NOT clicked |
| 10 Templates & Settings | PASS | All 5 template tabs load with no console errors; email editor is plain with a named chip and Insert field only; Settings logs a 404 for the logo (finding 11) |
| 7b, 11, 12 | not run | need files/reports/report templates seeded |
