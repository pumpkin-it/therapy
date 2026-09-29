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

## Checklist run log

Local run (fresh DB, no UAT access — UAT host is blocked by the environment network policy).

| Item | API-level | UI (Playwright) |
|------|-----------|-----------------|
| 1 Add client + duplicate warning | PASS | PASS |
| 2 Book appointment | PASS | not run yet |
| 3 Edit appointment | PASS | not run yet |
| 4 Cancel outside window | PASS | not run yet |
| 5 Late cancellation billed/unbilled | PASS | not run yet |
| 6 Session notes (both entry points) | PASS | not run yet |
| 7 Note PDF / email preview | PASS (PDF 200) | not run yet |
| 7b, 8, 10, 11, 12 | not run (need seeded templates/reports/files) | not run |
| 9 Invoicing to-send | PASS | not run yet |
