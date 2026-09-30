# Therapy app regression checklist

Living list of day-to-day operations that must keep working. Maintained semi-automatically:
whenever a session builds or changes something that touches one of these flows, updating this
file is part of finishing that task — not something the user needs to remember to ask for.
The user can also add to it directly at any time.

Scope note: this is a smoke-test checklist for things the practice relies on every day, not a
full test suite. Not every route/feature needs an entry here — only flows where a silent
regression would actually disrupt someone's day (booking a client in, writing up a session,
sending an invoice), matching the reason this file exists in the first place.

Each item: the flow, the concrete steps to exercise it, and what "still works" looks like.

## 1. Add a new client
Clients → Add client → fill first/last name, DOB, contact details → Save → new client appears
in the list and opens correctly. If a similar name/DOB/phone/email already exists, the
duplicate-detection warning banner appears (non-blocking). It fires when first **and** last name
match an existing client **and** at least one of DOB / phone / email also matches — or the email
alone matches. It's checked ~0.5 s after typing stops (the banner reads "Possible duplicate:").

**Clients list** (in production since 2026-09-29): 50 per page with "1–50 of N clients" and
Previous / Next. Search (name, full name, email, phone, or client code like C0012) and the
Active / Inactive / All filter both go back to page 1.

## 2. Book an appointment
Calendar → New appointment → pick Practitioner, Client, Funder (if the client has funding
periods), Start/End time, a real Service line item → Save → appointment appears on the
calendar at the right time/day, correct color per practitioner.

**Session note indicator** (added 2026-09-14, Day/Week/Month views): a fresh appointment with no
session note yet shows no icon next to the client name. Add a session note to it → the small
note icon appears next to the name in all three calendar views (the practice relies on this to
audit at a glance that every session has notes — a false icon, on either side, is a real bug).

**Service description on the block** (added 2026-09-14): the first line item's description (e.g.
"OT Session", "Report writing") shows under the suburb in Day/Week views, and combined with the
suburb on one line in Month view — lets you tell what an appointment is for without opening it.
Confirm it updates immediately after changing the service/description and saving.

## 3. Edit an appointment
Open an existing appointment → change time and/or a line item → Save → change persists on
reload (close and reopen the appointment, confirm the new value is still there — not just
optimistic UI).

**Window width** (in production since 2026-09-30): on a desktop-size screen the appointment window
is about 900px wide (`.fixed.inset-0 > div` width ≈ 896), and Cancel appointment, Notify
Practitioner, Notify Client, Close and Save all sit on **one row** at the bottom of the Details tab.

## 4. Cancel an appointment (no fee, outside the policy window)
Cancel an appointment booked well outside the cancellation-policy notice window (see item 5 for
the near-term/billable case) → appointment shows on the cancelled-only calendar toggle with the
plain "C" badge, hidden from the normal calendar view.

**Must use the dedicated "Cancel appointment" button** (bottom of the appointment modal, only
shown when editing a non-cancelled appointment) — NOT the generic Status dropdown + Save. They
are different code paths: only the dedicated button calls the cancel-policy check and shows the
confirmation popup; manually setting Status to "cancelled" and clicking Save updates the
appointment but skips the popup entirely. Confirmed 2026-09-08 by reading the source
(`AppointmentModal.jsx`'s `del()` vs the generic save handler) after live testing showed a
discrepancy — this is a real distinction in the app, not a bug in either path.

**Confirmation window** (updated 2026-09-29): since 2026-09-26 this no-fee path uses the in-app
confirm window (title "Cancel appointment", buttons **Keep it** / **Cancel appointment**) instead of
the browser's native confirm(), so it IS automatable now. Check both: **Keep it** leaves the
appointment untouched; **Cancel appointment** cancels it and then shows the "Appointment cancelled"
window with Notify Practitioner / Notify Client / Done — click **Done**, don't notify. Escape on the
confirm closes only the confirm, not the appointment window.

## 5. Late cancellation — billed and unbilled, verify the invoice extract
Added 2026-09-08 after a real historical bug (memory: "Late-cancellation billing dropped
travel/km/notes", fixed 2026-09-02) where a billed late cancellation silently under-charged —
exactly the kind of silent regression this checklist exists to catch, since it's real money.

Check the practice's current policy first — `Settings → Cancellation Policy`, or read
`settings.cancellation_policy` directly (a JSON array of `{days, percent}` tiers). As of
2026-09-08 it's a single tier: **2 business days' notice, 100% fee**. Book (or reuse) an
appointment inside that window (e.g. today or tomorrow) so the cancel-policy check reliably
returns a tier — this routes through the **custom in-app `lateCancelConfirm` UI**
(`AppointmentModal.jsx`'s `confirmCancel(applyPolicy)`), not the native `confirm()` dialog, so
both variants below are fully automatable through this tool, unlike item 4.

**Billed**: click "Cancel appointment" on a real (ideally same-day/next-day) appointment that
also has real travel/km/notes on its item → the policy prompt appears, showing the correct
tier % and notice period → click "Apply N% late cancellation fee" → confirm the appointment now
shows the **"LC" badge** (not plain "C") on the cancelled-only calendar view → open **Invoices →
MYOB Invoices** (or To Send) and confirm this appointment appears with a **non-zero amount** that
correctly reflects the fee-percentage line **plus** any travel/km/notes lines (this is exactly
the combination the historical bug dropped — don't just check that *an* amount shows, check that
travel/km/notes weren't silently zeroed).

**Unbilled**: click "Cancel appointment" on a second same-window appointment → at the same
policy prompt, click "Go back" / decline the fee instead → confirm it shows the plain **"C"**
badge (not "LC") → confirm this appointment does **NOT** appear on Invoices → MYOB Invoices at all
(cancelled + not billable should be fully excluded from the outstanding-to-bill list, unlike the
billed case above).

**Billing adjustment on a billed late cancellation** (fixed 2026-09-30 — a real bug on APT-00247,
where a $0 adjustment was ignored and the full fee still showed): open the **billed** one →
Billing adjustment tab → halve the Session rate → Save → OK. On MYOB Invoices its amount must drop
to the fee on the **adjusted** rate (e.g. 100% of $96.99 instead of $193.99), plus any
travel/km/notes. Then **Don't bill** → it shows $0 under **No charge** (see item 9). Revert to
original afterwards.

## 6. Session notes — add, from both entry points
- Via the appointment modal's own Session Notes section: add a note, Save → appears in the list.
- Via the client profile's Session Notes tab: add a note, Save → appears in the list.
Both entry points write to the same place — a note added one way must be visible the other way
(open the same appointment/client from both sides and confirm).

**Draft recovery** (added 2026-09-14, both entry points): start typing a note, then navigate away
without Save or Cancel (simulates an accidental tab/window close) → return to the same
client/appointment → the compose box reopens on its own with the typed text restored. Saving or
explicitly clicking Cancel must clear the recovered draft (retype something small, Save, navigate
away and back → compose box should stay closed, not resurrect the old text).

**Session date display + linking** (added 2026-09-14, client profile's Session Notes tab only):
a note added via the appointment modal (so it's linked to that appointment) shows that
appointment's date/time (e.g. "Monday 14/09/2026 at 10am") instead of when it was typed. A note
added standalone via the client profile tab has no appointment link, shows when it was typed
instead, and gets a **Link to appointment** action → opens a picker of that client's
appointments → pick one → the note's displayed date switches to the appointment's date/time and
the Link action disappears (now linked).

**Word-style note editor** (2026-09-26, replaces the Quill editor; both entry points, compose
and edit): the note is an A4 page with page guides and "N pages" underneath (in the appointment
window it's shown scaled down, "shown at NN%"). **Expand** fills the window at full size; Escape
or Done shrinks it back **without closing the appointment**. Type a note, apply bold, a colour,
a font and a bulleted list, paste a picture (it uploads and appears) → Add/Save → the note shows
in the list with the same formatting and picture → Edit reopens it intact. **Use template**
fills the composer with the template, fields filled in. **Older notes** must still display and
edit correctly: a plain-text note keeps its line breaks; a note written in the old editor shows
real bullets/numbering (nested where it was indented), no raw HTML or "ql-" leftovers.

## 7. Session notes — download / email
Select a note (appointment modal or client profile, both have this) → Download PDF succeeds
(real 200 response, real PDF bytes) → the PDF's date matches the actual session date, not
today, formatting, lists and pictures carry into the PDF, a page break in the note starts a new
page, and every page has the footer "<client> · Session notes · Page X of Y". Email button opens the pre-filled modal with the correct
recipient/subject/body, including the same correct session date in the body — **do not actually
click Send** (would dispatch a real email); confirming the pre-filled preview is correct is
sufficient.

## 7b. Client files — share a report and notify the client
Added 2026-09-14. Client → Files → upload a PDF/JPG/PNG → "Share file" → a "Draft shared" badge
appears with Copy link / Notify client / Edit pages shown / Mark as released / Stop sharing
controls.

Click **Notify client** while still in draft → modal title reads "Notify client (draft shared)"
→ preview body must NOT mention payment, must say it's a preview, and must include a working
`{{report_link}}` (`/report/<token>`) → **do not actually click Send** (would dispatch a real
email); confirming the pre-filled preview is correct is sufficient, unless the user has
explicitly asked for a real send test as part of this run.

Click **Mark as released** → status badge flips to "Released" → open Notify client again → title
drops the "(draft shared)" suffix, body now says the report is finalised and ready to download —
confirm the link itself is unchanged from the draft version (same token, just what it serves
changes server-side).

## 8. Fill in a form
Client → Forms → Fill in a form → pick a template through the folder picker (if the template
list has folders, confirm it's still navigable, not just a flat list) → leave a required field
blank and try Save → blocked with the missing fields highlighted → fill everything in → Save
succeeds → reopen the saved response, confirm the answers persisted correctly (including any
calculated/derived field, e.g. LEFS's auto-summed total).

## 9. Invoicing — reach the confirm step
Invoices → To Send (or MYOB Invoices, depending on `invoicing_mode`) → open a real unbilled
appointment → confirm the line items and total look right. Do not actually complete a real MYOB
export or send a real invoice email unless the user has explicitly asked for that as part of
this run.

**Note on `export_only` mode** (confirmed 2026-09-14): there is no separate confirm/preview
screen in this mode — clicking "Export MYOB CSV" is a single action that immediately calls the
export endpoint and stamps the appointment as exported. In this mode, **stop at "select the row
and verify the line items/total in the list view"** — do not click Export, since that would
complete a real (if harmless, QA-only-data) export rather than just previewing it.

**MYOB Invoices screen** (in production since 2026-09-29, `export_only` mode): seven status tiles (Not exported,
Exported, Unpaid, Part paid, Paid, No charge — added 2026-09-30 — and All) each show a count and $ that follow the date / client /
practitioner filters; clicking a tile filters the list. Dates default to **This week** (the whole week to Sunday, nothing after); check Last week, This
month, a Custom range and **All dates** — none of them show appointments after this week unless
**Include future appointments** is ticked. Each tile reads "chosen dates / all dates" (e.g. Not
exported 2 / 26), counts and $, both following the client/practitioner filters. Every row has a tick box; **select all** shows
only on Not exported, Unpaid and Part paid. Ticking an already-exported row and clicking Export
asks "Export again?" first (click Cancel). **Mark paid** appears only when every ticked row is
Unpaid/Part paid. Clicking a row's MYOB invoice cell (owner/admin/finance) opens the edit window:
invoice number, and payment — No payment / Part paid (amount paid ↔ amount due, worked out from the
invoice total) / Paid in full.

**Invoice number format** (in production since 2026-09-30): the number accepts letters and spaces as well as digits:
typing `inv 12a` shows `INV 12A`, saves, and the row then shows `INV 12A`. An all-digit number is
padded like MYOB's and shown with its zeros everywhere (MYOB Invoices list, the edit window, the
client's Reports tab): `2222` saves and shows as `00002222`. On QA data only — afterwards clear the
number (empty box → Save) so the row goes back to Not exported.

**No charge / Don't bill** (in production since 2026-09-30; QA data only): open a not-exported appointment → Billing adjustment tab →
**Don't bill** → confirm. A "Billing updated" popup appears; OK closes the appointment window and
the MYOB Invoices list refreshes by itself (no page reload). Reopen it: the tab now says "No charge", every Current subtotal is $0, and the Don't
bill button is gone. On the MYOB Invoices screen the row moves from Not exported to the **No charge**
tile (its own tile; also under All), with no tick box and "—" for the invoice number; the
Not exported count drops by one. Repeat on a **billable late cancellation** (e.g. Cancelled — 100%):
it must also go to $0 / No charge (a billing adjustment used to be ignored on cancellation fees).
**Revert to original** puts it back to Not exported at its full amount (same popup and refresh).
Saving an ordinary adjustment (change a rate → Save) also shows "Billing updated" and closes.
Budget and Reports follow the adjusted amount too: a No charge appointment adds $0 to the client's
funding budget spend and to Reports "$ Invoiced". Leave every QA appointment back at its original
billing (Revert to original) when done.

**Overdue report invoices** (UAT only until released; added 2026-09-30): a report invoice is overdue
when a report entry (client → Reports tab billing) is still not paid in full `report_overdue_days`
after the entry's date (Settings → Overdue Report Invoices; empty = 14). Counts whether or not it
has reached MYOB; leaves out voided entries, No charge ($0) ones and paid invoices. Entries on one
MYOB invoice are one item, aged from the earliest. Check with a report entry dated 15+ days ago
(QA data only — on a local copy, seed report entries with past dates: one with no invoice number,
two on one unpaid invoice number, one part paid, one paid, one recent, one voided):
- **Calendar banner** (first screen after sign-in): red "N report invoices overdue — $X not paid
  14+ days after the report entry". Each line: client (link → that client's Reports tab), report,
  (practitioner for finance), entry date and days ago, invoice number, status, amount due.
  Hide/Show collapses it; more than 5 → "Show all N". Owner/admin/finance see every one plus
  "Open in MYOB Invoices"; a **therapist** (practitioner role) sees only the reports they write,
  with "Please follow up with the client", and no sidebar number. The paid, recent and voided
  seeds must not appear; the two entries on one invoice show as one line.
- **Sidebar**: a red number on Invoices (finance roles only) = number of overdue invoices; clicking
  the number opens Invoices → MYOB Invoices on the **Overdue reports** tile.
- **MYOB Invoices → Overdue reports tile**: red while anything is overdue, one count (no "/ all" —
  it ignores the date filter) and "$X still due"; the list shows those entries, oldest first,
  each with an "Overdue · N days" badge; select all works; Mark paid on them → back on the
  Calendar the banner and the sidebar number drop (they refresh on each page change).
- Lettered invoice numbers show once ("INV 77", not "INV INV 77"); all-digit ones as "INV 00002222".

## 10. Templates & Settings pages load cleanly
Templates page — all five tabs (Email, Session Note, Agreement, Forms, Report) load without a
console error, consistent full-page width. Editing an **email** template: a plain box (no pages,
no picture or page-break buttons) with each {{variable}} shown as a named chip; Insert field adds
one. **Session note / agreement** templates: an A4 page with page guides and Insert field. Saving
and reopening keeps the chips; an agreement drafted from the template shows the real values. Settings page loads. **Budget Alerts → Send to** (UAT only until released; added 2026-09-30):
tick boxes for The client's practitioners, Owners, Admins, All practitioners and Finance (default:
the first three) plus the Practice alert inbox; untick/tick some, Save, reload — the choice is kept.
Put it back as it was afterwards. (Don't trigger a real alert email.) Reports page loads and returns data for
a normal date range.

## 11. Report billing (client → Reports tab)
Start a report on the QA client, log hours at a running total % (e.g. 50%), confirm the entry
shows the right hours × rate amount and does NOT appear on the calendar. On UAT every email is
redirected to the test mailbox, so billing a real entry is safe there — check the accounts email
arrived with a MYOB CSV whose line note reads "Report: <title> — 50% complete". Confirm a lower
% than the current total is rejected. Upload a PDF, confirm the Files tab shows it as a billed
report with no "Mark as released"/delete controls, and that the client link shows the blurred
draft. As owner/admin/finance, click the entry's invoice number ("Add inv #") → the MYOB invoice
window opens (invoice number + payment); set a number and Part paid → the entry's status updates
(in production since 2026-09-29). Void the entry (admin/finance) and delete the QA report data afterwards.

**Delete a fully voided report** (in production since 2026-09-29): once every entry on
the report is voided, the report's **Delete** button appears even though it has a file. The
confirm text says the voided entries stay in the history and the client's link will stop working.
Delete → the report leaves the Reports tab; the client link (/report/<token>) now shows "not
found"; the file stays in Files as a plain unshared file (a "Share file" button, no "billed report"
label), and it can now be deleted there. The voided entry still does NOT appear on the calendar.
A report with a live (not voided) entry still has no Delete button (the API returns 409).

## 12. Report writing and report templates (in production since 2026-09-26)
Added 2026-09-25. **Templates → Report Templates tab** (owner/admin) → open "Standard report" → fields show
as green labels, logo shows, Save stays greyed until something changes. Client → Reports → Start
report with a template → Continue writing → every field on the cover page shows the client's real
values (missing ones in amber), the footer shows words · pages, and "Saved <time>" appears a few
seconds after typing stops. **Insert field mid-sentence and keep typing** — the typed text must
land AFTER the inserted field (found broken 2026-09-25: the field menu stole focus). History opens
and lists saved copies. Page guides ("Page 2" etc.) appear when the text passes an A4 page.

**Commit / lock / versions** (added 2026-09-26): click Commit → the dialog offers "pages shown in
full" (max half the pages) → Commit → lands on the client's Reports tab with the draft email open
(don't send unless asked). The card shows "version 1 committed, locked"; Files has "<title>
(version 1)"; the client link shows the blurred draft. Open the report → "Locked" banner, no
toolbar. Unlock to revise → a reason is required → edit → Commit again → version 2. The client
keeps **the same link for the whole report** (since 2026-09-26): the link from the version 1 email
still works and now shows version 2 as a blurred draft. History → version 2 → Changes
shows the edit (added green/underlined, removed red/struck through); PDF buttons download each
version.

The Standard template's cover shows "Prepared by" (name) and "Position" (title) on separate
rows, "Plan dates" as one field, and the practice contact line — no stray "," "·" or "–" when a
value is missing (fixed 2026-09-26).

**Forms note (2026-09-25):** UAT's current form templates have no required fields and no folders
(the LEFS form was lost in an earlier UAT data refresh), so item 8's "blocked with missing fields"
and folder-picker checks can't be exercised on UAT until such a template exists there again.

## 13. Audit log (in production since 2026-09-29)
Audit Log page shows the newest 200 entries; **Load older** adds the next 200 ("showing 400").
Changing the type filter starts again from the newest.

## 14. Sign-in security (in production since 2026-09-29)
- **Lockout:** 10 wrong passwords for one email → the 11th attempt (even with the RIGHT password)
  shows "Too many attempts — try again in 15 minutes." Other emails can still sign in. Use a
  throwaway QA account, never a real user's email. (Limits are per server process and reset when
  the service restarts.)
- **Forgot password:** more than 5 requests for one email in an hour → "Too many attempts".
- **Password length:** the reset-password page and Users → edit (own password, or a user with no
  email) reject anything under 8 characters.
- **Reset links:** sending a new set-password link makes any earlier unused link for that user
  stop working ("Invalid or expired reset link"); using a link also retires the others.
- **No password hashes sent to the browser:** signed in as owner/admin/finance, DevTools → Network
  → GET /api/practitioners (Users page) and GET /api/practitioners/<id> → the JSON has no
  `password_hash` field. Users page still lists, edits and saves users normally.

---

## How to run this (read first)
**Claude can't sign in to UAT or production** — it may not type a password into a non-local site,
and token injection counts as the same thing. So there are two ways to run the checklist:

**A. On UAT, with the user signed in.** Ask the user to open https://therapy-uat.pumpkinit.com.au
in the Browser pane and sign in themselves (allowing the site first if asked), then drive the
pane. Every email UAT sends is redirected to the UAT test mailbox, so item 11's accounts email can
be checked there. Don't send client-facing emails even so — stop at the preview.

**B. On a local copy of the current build (no sign-in needed).** Same code as UAT; nothing leaves
the machine. Follow memory `process_local_ui_qa.md`:
1. `cd client && npx vite build` (the build UAT is running).
2. Copy `server/pm.db` into the scratchpad as `qa.db` (plain `cp` — `sqlite3 -readonly .backup`
   fails when there's no -shm file). Never touch `server/pm.db` itself.
3. A wrapper server that redirects better-sqlite3 to qa.db, blocks every non-localhost
   fetch/http/https request, sets PORT=3001 and APP_URL=http://localhost:4173, then requires
   `server/index.js`. Serve the client with `client/node_modules/.bin/vite preview <client> --port
   4173`. Add both to **/Users/peterchen/Claude/.claude/launch.json** (the workspace-root file the
   preview tool reads) and start them with preview_start.
4. The local DB is nearly empty, so seed qa.db before starting:
   - a test **owner** (random bcrypt password saved to a scratchpad credentials file, not shown in
     chat);
   - a **practitioner** to book with (the owner doesn't show in practitioner pickers);
   - NDIS `service_rates` with travel_rate_per_hour, km_rate, notes_rate and cancel/travel/km/notes
     codes (item 5 needs them);
   - `cancellation_policy` = `[{"days":2,"percent":100}]`;
   - `invoicing_mode` = `export_only` (production's mode);
   - `accounts_email`;
   - a session_note template;
   - a form_template with a `folder` (e.g. "Assessments/Mobility"), required fields and a
     `calculated_sum` over two dropdowns (item 8);
   - a small multi-page PDF in the scratchpad for uploads.
   The existing sample appointments are referenced by old invoices, so mark them
   `is_invoiced = 1` rather than deleting them.
5. Uploading files: the pane has no file picker. Build a `File`, put it in a `DataTransfer`, set
   `input.files` and dispatch `change`; paste pictures with a synthetic `ClipboardEvent`.
6. The local server logs "JWT_SECRET is not set" — expected locally (no .env); it uses a random
   secret, so restarting the API server signs the browser out. Tool quirks: date inputs need the native value setter plus input/change events; the pane's own
   Escape key doesn't reach the page, so dispatch a `KeyboardEvent`; screenshots can lag a step
   behind, so check the DOM; `document.querySelector('h2')` can hit editor headings, so use
   `.fixed.inset-0 h2` for pop-up windows.
7. Afterwards: stop both servers, delete files the run created under `uploads/` (find newer
   than the seed script), the qa folder, and the launch.json entries.
With B, emails can't be checked (they're blocked). Check item 11's accounts email on UAT with
option A, or skip it and say so.

## Standing rules for whoever runs this (human or agent)
- Run against **UAT** (`https://therapy-uat.pumpkinit.com.au`) with the user signed in, or a
  local copy of the current build (see "How to run this") — never production, unless the user
  explicitly asks for a specific check to be run against production too.
- On UAT, work as the user's own sign-in, and put all test data on a clearly-named QA client.
  On a local copy, use the seeded test accounts. Never reuse or overwrite a real practitioner's
  credentials.
- Never actually send a real email or complete a real financial transaction during this run —
  stop at the confirmation/preview step for anything like that.
- Clean up every piece of test data (notes, appointments, clients, the QA account itself)
  created during the run before finishing, regardless of pass/fail outcome.
- Report a clear pass/fail per checklist item, not just an overall verdict — flag anything that
  didn't fully match "what still works" above with enough detail to reproduce.

## Changed since the last full run (check these first)
Released to production 2026-09-30 — not yet covered by a full run:
- Item 3: wider appointment window, buttons on one row.
- Item 5: billing adjustments now apply to late-cancellation fees.
- Item 9: invoice numbers with letters/spaces and zero-padded display; Don't bill button;
  No charge tile/status; "Billing updated" popup that closes the window and refreshes the list.
- Item 9 (UAT only until released): overdue report invoices — Calendar banner, sidebar number,
  Overdue reports tile, Settings → Overdue Report Invoices.
- Item 10 (UAT only until released): Settings → Budget Alerts "Send to" choices.

## Last full run — 2026-09-29 (UAT, option A, user's own sign-in)
Result: **items 1–13 incl. 7b all PASS**; no functional failures, no console/network errors.
Test data was on QA client "ZZ QA Regression 2026-09-29" (id 87). Bugs: see memory file
`project_therapy_regression_bugs_2026-09-29.md`.

| Item | Result | Notes |
|---|---|---|
| 1 Add client | PASS | Duplicate-client warning appears on re-entering existing name + email ("matched on email") |
| 2 Book appointment | PASS | |
| 3 Edit appointment | PASS | |
| 4 Cancel, no fee | PASS | A billed late-cancel (LC) appointment stays visible (faded red) — looks intentional; wording above may need an LC exception |
| 5 Late cancellation | PASS | Billed and unbilled paths |
| 6 Session notes | PASS | Incl. legacy notes, drafts, templates |
| 7 Download / email | PASS | Both entry points; Send not clicked |
| 7b Client files | PASS | |
| 8 Fill in a form | PASS (limited) | UAT has no required fields, folders or calculated field — those checks not exercisable there (use a local copy) |
| 9 Invoicing | PASS | Manual MYOB edits, MYOB Invoices tiles ("chosen / all dates", future appointments hidden) all OK |
| 10 Templates/Settings/Reports | PASS | |
| 11 Report billing | PASS (part unverified) | Accounts email + MYOB CSV not verified — no access to the UAT test mailbox |
| 12 Report writing | PASS | |
| 13 Audit log | PASS | "Load older" 200 → 400, filter resets |

Also verified: Clients pagination (1–50 of 51, Prev/Next, filter resets to page 1).

Known issue (low): voiding the only billed entry on a report leaves the report file "Draft shared"
with a live link that can't be deleted/unshared (409 "billed report"). **Fixed on UAT 2026-09-29**
— see item 11 "Delete a fully voided report" (report 7 / file 203 can now be cleaned up that way).

Cleanup gaps (app cannot hard-delete): QA client 87 + filler clients 88–90 still active, form
response 16, funding period 65, billed report 7 (file 203), two /api/report-images uploads.
