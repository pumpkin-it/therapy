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

**Merging duplicates** (on UAT since 2026-10-01, owners/admins only): on the duplicate's page →
**Merge into…** → pick the client to keep (same-name clients listed first) → side-by-side details
(amber = only on the duplicate, not copied) and "Moves to …: 1 invoice, 3 appointments…" → Merge. You
land on the kept client, which now has those records; the duplicate disappears from the client list and
email suggestions, and its page shows "This duplicate record was merged into …" with **Undo merge**
(moves exactly those records back). Both clients' History tabs record it.

**Clients list** (in production since 2026-09-29): 50 per page with "1–50 of N clients" and
Previous / Next. Search (name, full name, email, phone, or client code like C0012) and the
Active / Inactive / All filter both go back to page 1.

**Contacts** (in production since 2026-10-02): the Details tab has a Contacts list
instead of the old Emergency contact / Case manager boxes. Existing emergency contacts appear in it
(with an Emergency badge). Add contact → pick a role, name, email → Save contact → it appears
straight away. Saving without a name shows "Name is required"; a bad email shows an error. Ticking
Primary on one contact removes it from any other. Edit and Remove (asks to confirm) work, and each
change appears on the History tab. On a new client, contacts added before "Create client" are saved
with it.

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

**Overdue report invoices** (in production since 2026-09-30): a report invoice is overdue
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
and reopening keeps the chips; an agreement drafted from the template shows the real values. Settings page loads. **Budget Alerts → Send to** (in production since 2026-09-30):
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
**Owner/admin/finance only** (in production since 2026-10-02): a practitioner
sign-in has no Audit Log link, /audit-log goes back to their home page, and GET /api/audit-logs
without entity_id returns 403. A client's or appointment's own History still works for them.
Also GET /api/settings for a role without the Settings permission has no bank_*, graph_*, smtp_*,
accounts_email, remittance_email, role_permissions, budget_alert_to, email_reasons_to_tags or
invoice_counter (practice details, invoicing_mode and the Maps key remain).

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

## 15. Email — filing (in production since 2026-10-02)
UAT copies mail from the test mailbox (therapy-test@i2solutions.org.au). On a local copy, seed sample
emails through the real sync with a fake Graph server.
- **Email** in the sidebar (owner/admin only by default — Settings → Permissions → Email). The amber
  number beside it = emails waiting to be filed. Tabs Unfiled / Filed / No client / All, newest first.
- Opening an email shows who it's from/to, the body, attachments and other emails in the same
  conversation. Pictures from the internet stay hidden until "show them" is clicked.
- **Clients**: suggested clients are listed with why — client's email, contact, plan manager, Outlook
  folder, same conversation, "Named in the email: …" (full name), "First name in the email: …" (for a
  client linked to the sender, or a unique first name), "Filed here before (N emails…)". Pre-ticking
  errs towards too many: every named client is ticked (two named → both); with nobody named, all of a
  known sender's clients (up to 3) are ticked. Search adds any other client. Inactive clients are
  still suggested, shown as "Name - INACTIVE"; one is ticked like anyone else unless an active client
  with the same name is also suggested (a duplicate record — then only the active one is ticked).
  Hyphens and spaces in names match each other ("Yong Sheng" = "Yong-Sheng").
- **Tags** (separate from clients, any number): Invoice / payment, Referral / enquiry, Appointment /
  scheduling, Report, Quote / equipment, Plan / funding, Practice admin, Supplier, NDIS / general,
  Newsletter / marketing, Spam, plus "+ New tag". Suggested tags have a sparkle and come first; strong
  ones (word in the subject, invoice/quote attachment, newsletter, sender usually tagged so) start
  selected, body-only ones are dashed and unselected.
- **File** (Ctrl/⌘+Enter) → the email leaves Unfiled, the next one opens, the sidebar number drops;
  unfiled emails in the same conversation are filed too. With no client ticked the button is
  "File — no client" (goes to No client, keeps its tags). "Move back to Unfiled" undoes either.
- After filing an email from someone not on file: "…isn't on file for <client>. Add them as a
  contact?" (role guessed: school domain → School, gmail etc. → Family, else Support coordinator);
  adding makes their other unfiled emails suggest that client.
- The **All tags** filter (with counts) narrows any tab. Search highlights the words in the list and
  in the open email (scrolls to the first). Rows show clients (solid) and tags (coloured).
- Tick several emails → bulk bar: file all to client(s) or "No client", and/or add tags ("Only add tags").
- Client → **Communications** tab lists that client's emails (with tags), newest first; opening one
  allows changing its filing. Filing shows on the client's History tab.
- A practitioner sign-in doesn't see Email or the Communications tab (API answers 403).

## 16. Email — writing and sending (in production since 2026-10-02)
On UAT every email is redirected to UAT_TEST_MAILBOX (peterchen@flexisupport.com.au) with the real
recipients listed in a yellow box at the top — never to real people. Sent from the test mailbox.
- Email page → **New email**; an open email → **Reply / Reply all / Forward**; client page → **Email**
  (To = primary contact, else the client's email; filed to that client); Communications → **New email**.
- Reply fills To (the sender), Reply all adds the others as Cc, subject "RE: …"/"FW: …"; the original
  is quoted below (expandable preview). Signature ("My signature" to edit) is added at the end.
- To/Cc/Bcc suggest the chosen clients' contacts first, then anyone on file / who has emailed us.
- **File the sent email to**: clients (pre-filled) or "No client", plus tags — required to send.
- Attach files (or drag onto the window); forward keeps the original's attachments.
- Send (or Ctrl/⌘+Enter) → bottom bar "Sending in 10s … Undo". Undo reopens the email unchanged
  ("Sending was undone"). After sending: "Sent: …", and it appears on the client's Communications tab
  (outgoing arrow) within seconds, threaded under the original in Outlook.
- Closing the window keeps the draft in this browser ("Restored your unsent draft" next time).
- **Schedule send**: the arrow next to Send → Tomorrow morning / Tomorrow afternoon / Monday morning
  (with dates shown) or a chosen date and time (at least a minute ahead) → "Scheduled for …". Email page
  → **Scheduled** tab (count) lists them; each can be **Send now**, **Edit or reschedule** (the original
  stays scheduled until the edit is sent/scheduled; closing the editor leaves it as it was), or
  **Cancel**.
- Failure: a red box "Couldn't send …" with Open / Try again / Discard. If it says "may or may not have
  finished", check the mailbox's Sent Items before trying again.

## 17. Tasks — the to-do list (in production since 2026-10-02)
Tasks start from what's in the Outlook Inbox once it has been fully copied in (one task per
conversation; newsletters skipped); past mail never creates tasks.
- Sidebar **Tasks** (red number = To do). Tabs To do / Waiting / Done with counts; Everyone / Mine /
  Unassigned / a person; search; **New task** (title, next step, clients, To do or Waiting + follow-up
  date, assignee).
- A task shows: title (click to edit), To do / Waiting (with follow-up date) / Done, assignee, next
  step, clients (add/remove), its emails (open, or "Reply to the latest"), notes and a history of every
  change (who, or "automatic").
- Automatic: a new email starts a task (or puts its conversation's task back to To do); a reply sent
  from Outlook puts it to Waiting (follow up in 3 working days) — never Done; a Waiting task whose
  follow-up date arrives comes back to To do ("No reply since …").
- Writing an email: **After sending** — Waiting for a reply (+ date, the default for replies) / Done /
  Keep as To do / Leave as it is ("Don't track" for a new email).
- An open email shows its task ("Task: … · Open task") or "+ Create a task for this email"; email list
  rows show To do / Waiting / Done.
- Client → Communications tab → **Open tasks** for that client (+ New task).
- **Auto-filed** (badge "Auto-filed"): from someone on file for one client only (own email, a contact,
  or filed there twice before by people) and naming no other client. An organisation's address (not
  personal webmail like gmail) must also name that client. An address whose emails people have filed to
  two or more clients is treated as shared: auto-filed only when exactly one client is named in full.
  Moving an email back to Unfiled sticks (never auto-filed again).
- Name matching copes with run-together / spaced / hyphenated names and bracketed nicknames: "Tian Yun
  Li", "TianYun Li" and "Jupiter Li" all match "TianYun (Jupiter) Li"; "ManNa" matches "Man Na";
  "Alex Woo" / "Alexander Woo" match "Alexander (Alex) Kaizeng Woo".
- Moving an email out of the Outlook Inbox does NOT close its task (setting tasks_done_when_left_inbox,
  off by default). Therapy never moves anything in Outlook.

## 18. Agreements — mark as signed on paper (in production since 2026-10-02)
Client → Agreements → open a **sent** or **viewed** agreement → **Mark as signed**. The dialog has
Date signed (today by default; future dates are blocked), Signed by (the client's name by default)
and an optional Signed copy file. Back-date it a few days, attach a PDF, Mark as signed:
- Status badge turns **Signed**; a green box says "Signed by … on <date> · on paper, marked as
  signed by <you>", with **Download** (gets the same file) and **Replace copy**. No Resend email
  button. The list row shows "Signed <date>". History shows "Marked as signed (on paper) …".
- The file appears in the client's Files tab, labelled "Signed: <agreement title>".
- **Download PDF** ends with an audit trail saying "Signed on paper: <date>" / "Marked as signed by".
- No more reminders: the agreement isn't in the sent/viewed list the reminder job reads. The client
  gets no email.
Also: a **draft** agreement has Mark as signed too (no link or email is created); marking it with no
file shows "No signed copy uploaded yet" and **Upload signed copy** adds it later. Signed, declined
and voided agreements have no Mark as signed button.

## 19. Ask (AI) — questions answered from the records (in production since 2026-10-02)
Claude Sonnet 5 on Amazon Bedrock in Australia reads Therapy's records (read-only) and answers with
numbered links to its sources. **Every question costs real money (about 1–30 US cents)** and counts
toward the monthly limit — ask **no more than 6 questions** in a run. UAT only (option A): a local
copy has no Bedrock access; on a local copy check only the permission/menu points marked (local).
- Sidebar **Ask** (owner/admin by default). Settings → Role Permissions has an **Ask (AI)** column;
  practitioner and finance off by default. (local) A practitioner sees no Ask menu, no Ask button on a
  client page, and `GET /api/ask/status` returns 403.
- Ask page → "When did Jupiter go for his equipment trial?": grey status lines appear while it
  searches ("Looking up…", "Searching for…", "Reading file …"), then the answer: **3 September 2026**,
  recliner and hi-low bed trial at Back to Sleep Balwyn, with a numbered source chip. The chip and the
  source list under the answer link to the record (file → client's Files tab, note → Session Notes,
  appointment → the appointment, email → Email page with that email open).
- Follow-up in the same conversation ("What was quoted for him?") answers without re-asking who
  "him" is; the conversation appears in the left list and reopens with all its questions and answers.
- Client page → **Ask** button → Ask page shows "About <client>" above the box; the question is about
  that client. The × on the chip (before asking) switches back to all clients.
- A question the records can't answer (e.g. "How high is the recommended step for Nai-Shing's back
  door?") says it isn't recorded and what IS on file — it must not invent a figure.
- Settings → **Ask (AI)**: Model (Claude Sonnet 5 default; Claude Opus 5.5, Claude Haiku 4.5 and
  Amazon Nova Pro also listed), Monthly spending limit (US$20), "Spent this month" — goes up after
  questions. The Ask page header shows the model and US$ used this month.
- Limit reached: temporarily set the limit to 0.01 (below what's been spent), Save, ask anything →
  "This month's Ask spending limit … has been reached" and no answer. **Set it back to 20 and Save.**
- Don't change the Model setting permanently; if you try another model, set it back to Claude Sonnet 5.
- (In production since 2026-10-02 21:38, not yet regression-tested.) Ask list: **search** box (questions and answers,
  with the matching snippet), **My questions / Everyone's (filed to clients)**, **client filter**. **New
  question** always clears the screen (an answer still arriving for the old one is dropped). A new
  question first checks earlier questions for free: close matches show as "This looks like it's been
  asked before" cards (Open this answer / Ask anyway / Edit my question); status questions (delivered,
  approved, latest…) carry a "may have changed since" warning.
  Each question shows "Asked <date time>" and each reply "Answered <date time>". A new question appears
  in the list straight away marked "Answering…"; switching to another chat (or asking another question
  there) while it's answering keeps each answer in its own chat; reopening an answering chat shows
  "Answering…" until it lands. Ask won't take a second question in a chat that's still answering. A
  restart mid-answer marks the question "interrupted — please ask it again" (red).
- (In production since 2026-10-02 20:42.) Settings → Ask (AI) has **How hard it works**
  (Low default / Medium / High). Answers are short: the answer first, about 120 words, no repeated
  summary line, "not recorded" with one short phrase of where it looked. Client history lists the last
  12 months by default and Ask looks further back by itself when needed (status line "Reading the
  client's history from <date>").
- **Filed to clients** (in production since 2026-10-02 14:16): each conversation is
  filed automatically to the client it was asked from, clients whose records its answer cited, and
  clients it looked up specifically. Inactive (past) clients are filed too, shown "<name> - INACTIVE" —
  except an inactive record whose name matches an active client in the same conversation (same
  rule as email). A "Filed to" bar above the
  conversation shows them; × takes one off, **Add client** adds one. Client → **Communications** tab
  → **Ask conversations** lists every conversation filed to that client, from anyone with Ask
  access ("You" or the asker's name). Opening someone else's conversation shows it read-only ("Asked
  by …", no follow-up box). Filing / unfiling adds "Ask conversation filed / removed" to the client's
  history with who did it. The Communications tab shows for anyone with Email **or** Ask access (Ask
  only → no emails section).

## How to run this (read first)
**Claude can't sign in to UAT or production** — it may not type a password into a non-local site,
and token injection counts as the same thing. So there are two ways to run the checklist:

**A. On UAT, with the user signed in.** Ask the user to open https://therapy-uat.pumpkinit.com.au
in the Browser pane and sign in themselves (allowing the site first if asked), then drive the
pane. Every email UAT sends is redirected to UAT_TEST_MAILBOX (peterchen@flexisupport.com.au) with
the real recipients listed at the top, so item 11's accounts email can be checked there. Don't send
client-facing emails even so — stop at the preview (item 16 has its own rule, below).
UAT's Email page holds real mail copied from the test mailbox (therapy-test@i2solutions.org.au) and
its Tasks page real tasks. For items 1, 15–17: create test data on clearly-named **ZZ QA** clients,
tasks and contacts; if you file/tag a real email to check something, put it back as it was
(Move back to Unfiled / untick tags) and say which emails you touched. Don't merge real clients —
merge two ZZ QA clients, then Undo merge.

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
   - a **practitioner** to book with (the owner doesn't show in practitioner pickers) — give it a
     login too (random password in the same credentials file) for item 9's therapist view;
   - for item 9's overdue report invoices: two `billable_reports` (one written by that
     practitioner, one by the owner) with report-entry appointments (`billable_report_id`, an
     `appointment_items` row each) dated in the past: 35 days, no invoice number; 23 and 21 days
     on one unpaid invoice number (`myob_status` 'open'); 16 days part paid (`myob_amount_due`
     less than the total); 40 days paid (`myob_status` 'closed'); 5 days (too recent); 30 days
     voided (`status` 'cancelled'). Expect 3 overdue: the no-number one, the shared invoice as one
     line, and the part-paid one;
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
7. **Email, Tasks, Communications (items 15–17).** After the step-4 seed, run
   `server/scripts/qa/seed-email.js` through the same wrapper (it refuses to touch server/pm.db):
   it adds ZZ QA clients with contacts and 9 emails covering each filing case, and starts tasks.
   Set MAIL_LOCAL_DIR to a scratch folder in the wrapper (stored email files go there, not
   uploads/). For sending (item 16): run `node server/scripts/qa/fake-graph.js` (port 4597; add it
   to launch.json too), set GRAPH_BASE_URL=http://localhost:4597/v1.0 in the wrapper, and make the
   wrapper answer `https://login.microsoftonline.com…` fetches with
   `{"access_token":"qa","expires_in":3600}` (all other non-localhost requests stay blocked). Sent
   emails are printed in the fake server's log (preview_logs) and appear on the client's
   Communications tab. Merge (item 1) and practitioner-permission checks need two ZZ QA clients and
   a practitioner sign-in from the step-4 seed.
8. Afterwards: stop all servers, delete files the run created under `uploads/` (find newer
   than the seed script), the qa folder (incl. the MAIL_LOCAL_DIR folder), and the launch.json
   entries.
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
  stop at the confirmation/preview step for anything like that. Item 16 exception: test sending with
  **Undo** (press Undo within the 10 seconds — nothing is sent) and **Schedule send → Cancel**; on a
  local copy, send freely to the fake mail server. On UAT, a real (redirected) send only if the user
  says yes in this session.
- Clean up every piece of test data (notes, appointments, clients, the QA account itself)
  created during the run before finishing, regardless of pass/fail outcome. Things the app can't
  delete (ZZ QA clients, tasks, contacts): deactivate clients, mark tasks Done, remove contacts, and
  list what's left in the report.
- Report a clear pass/fail per checklist item, not just an overall verdict — flag anything that
  didn't fully match "what still works" above with enough detail to reproduce.

## Changed since the last full run (check these first)
- On UAT 2026-10-08 (not yet in production): **PDF table header lines** — the grey header row of tables in
  agreement / session-note / report PDFs was missing some column lines (e.g. between Code and Qty in the
  agreement pricing table). Download an agreement PDF with a linked budget: every header and body column line
  shows, including on a page where the table continues.
- On UAT 2026-10-08 (not yet in production): **agreement budgets can't silently change after sending**.
  Draft: link/unlink/switch/create budget as before. Sent/viewed: any of those asks first ("Agreement already
  sent… takes it back to draft"); confirming puts it back to Draft, the client's old link shows "This link is no
  longer valid…", reminders stop, NOTHING is emailed; then Send it again by hand. Signed/voided: no
  Link/Unlink/Switch/Create budget controls (API refuses with 409). Every sent/signed budget-linked agreement
  shows "Sent/Signed for $X" — amber when the linked budget now differs or was revised, with (signed) "Create a
  new agreement from the current budget" or "Open the draft agreement on the current budget (#N)" if one exists.
  Real case: Stuart Nethercott agreement #22 (signed for $4,402.52, budget now $5,082.54) → button should open
  existing draft #23. DO NOT send agreements to real clients while testing.
- On UAT 2026-10-08 (not yet in production): **client → Billing → Billed period by discipline**. A "By
  discipline" table under the Invoiced / Scheduled / Total boxes splits the chosen range (rows add up to the
  total; services with no discipline show as "No discipline"). No dropdown filter (user: the table is enough). Joanne Cushing (C0048),
  08/10/2025–08/10/2026: OT $4,676.09 (matches her OT budget), Physio $9,373.73 + $695.98 scheduled.
- On UAT 2026-10-07 (not yet in production): **email window no longer says "Email isn't connected" when the
  status check simply failed** (e.g. during a restart) — it retries for ~15 s, then says Therapy can't reach
  email right now; Send stays disabled until the mailbox is known. Deploy scripts now clear the old build and
  skip macOS "._" files (UAT cleaned up: 1,164 stray files and 441 old build files removed).
- On UAT 2026-10-07 (not yet in production): **Reports tab → "Add calendar billing"** on a report: lists the
  client's past billed appointments not on any report (report services first, invoice # / MYOB status shown,
  % pre-filled from an invoice note like "FCA 60% done"). Adding one: it shows in the report's entries with
  a "calendar" tag, counts towards progress/total/release, leaves the calendar, nothing is emailed to
  accounts, invoice line unchanged. Progress must fit in date order among the other entries (error
  otherwise). "Take off" puts it back on the calendar. Real case: Cameron Noble APT-00597 (17 Sep 2026,
  5 hrs NDIS OT Report, inv 00000984, "FCA 60% done") → create an FCA report, add it at 60%.
- On UAT 2026-10-06 (not yet in production): **AI foundation** (front desk stage 1). Ask now calls AI
  through one gateway (server/services/ai/gateway.js) and its usage goes to the new ai_usage table
  (old ask_usage rows copied in). Check: Ask still answers with sources, streaming text, follow-ups,
  spending shown in Settings → Ask matches before. Documents (client files, note files, email
  attachments, backup zips) are now read once into a stored text table by a background queue
  (every 5 min) — Ask search over PDFs/zips must still find the same documents. New **Settings → AI
  overview** section: this month's cost per feature and model, overall limit, models per job type
  (Quick jobs / Everyday / Hardest cases — saved with Settings), documents read/waiting, background
  work. Nothing else in the app changes.
- On UAT 2026-10-06 (not yet in production): **Ask reads only the relevant pages** of long documents
  (read_record look_for / pages; documents over 6,000 characters come back in pages). Check answers
  still cite the right documents and find details deep inside long reports.
- On UAT 2026-10-06 (not yet in production): **Ask answer clean-up** — answers never start with a comment on
  the record just read ("This letter doesn't mention…") and don't end by asking staff to confirm/clarify;
  a quote headed "urgent order" is described as quoted (ordered only with a PO/confirmation/invoice/email).
  Re-ask "Which equipment did Jupiter end up getting?" → quoted, no record of order/delivery.
- On UAT 2026-10-06 (fixes from the AI regression run): Ask limit block shows ONE message and keeps the typed
  question; AI overview limit updates right after Save; no flicker after a follow-up answer finishes;
  Nai-Shing step answer has no "in this note…" opener or "if it exists elsewhere" closer; "what was
  recommended" answers come from the assessment, not quote line items.
- On UAT 2026-10-06 (not yet in production): **Email list shows the time** each email arrived — today's show
  only the time ("4:30 pm"), earlier this year "6 Oct, 4:30 pm", older ones with the year.
- UAT email setup changed 2026-10-06: UAT now **reads and sends from the real practice mailbox
  ahp@i2solutions.org.au** (UAT_MAIL_SYNC_MAILBOX; the therapy-test@ mailbox was removed). It only reads
  (never moves/deletes in Outlook). Every UAT send is still redirected to UAT_TEST_MAILBOX
  (peterchen@flexisupport.com.au) with "[UAT TEST]", but its copy lands in ahp@'s Sent Items — so
  production Therapy will also copy it in. Real UAT sends still only with the user's yes.
- On UAT 2026-10-06 (not yet in production): **email body and My signature use the Word-style
  editor** (same as notes/templates): fonts, sizes, **font colour**, highlight, alignment, tables and
  **pictures** (picture button, paste or drag — e.g. a logo in the signature). Pictures are sent as inline
  attachments (show without "download pictures"); check on a local copy with the fake mail server that a
  sent email's pictures arrive (the [fake-graph] log lists attachments). Line spacing matches Outlook: no gap between
  lines (paragraphs) in the editor and in the sent email; an empty line stays a blank line. Email templates
  keep their paragraph gaps. Templates → pictures in email /
  note / agreement templates now upload for anyone with the Templates permission (was owner/admin only).
- On UAT 2026-10-06 (not yet in production): Email **New** tab (now the default, and the sidebar Email
  number): every incoming email since the inbox started (2 Oct) stays in New — even when filed
  automatically (it shows where it went) — until a person deals with it: files it (any way, incl. bulk
  and the client's Communications tab), replies/forwards from Therapy, or clicks **Done** (above the
  email; bulk **Mark N done**). A dealt-with email shows "Dealt with <date> · Move back to New". Undo
  filing also restores whether it was in New. Emails already filed by a person or replied to before this
  release start as dealt with.
- Released to production 2026-10-06 13:02 (not yet regression-tested): one **Templates** permission (Settings → Role Permissions;
  owner/admin on, practitioner/finance off by default; replaces the short-lived "Report templates" one —
  a role that had it ticked keeps it). With it, the sidebar **Templates** page shows all tabs (Email,
  Session Note, Agreement, Forms, Report) and the person can create, edit and delete templates; without
  it there's no Templates item, but templates are still used (note templates, email pre-fill, starting a
  report). The owner can always manage templates. Settings is no longer needed for templates.
- Released to production 2026-10-05 12:28 (not yet regression-tested): **practitioners can now read templates.** As a practitioner:
  Session Notes → select a note → **Email** → Subject and Message are pre-filled from the session notes
  email template (they were blank before); session-note templates are offered when writing a note;
  Reports → Notify client uses the practice's template. Creating/editing/deleting templates still needs
  Settings (a practitioner gets 403 on POST/PUT/DELETE /api/templates).
- Item 19, released to production 2026-10-02 14:16: Ask conversations are **filed to
  clients** and listed on the client's Communications tab (shared with everyone who has Ask); see
  item 19 "Filed to clients". Test with existing conversations where possible (questions cost money).
- Released to production 2026-10-02 13:55 (user requests):
  - Item 15: **Undo filing.** After filing (File, File — no client, Move back to Unfiled, or the
    bulk bar) the green message names what happened and has **Undo**; Undo puts the email (and any
    earlier emails of its conversation filed with it) back exactly as before — clients, status, tags
    — and reopens it. Also on a client's Communications tab when an email is taken off that client.
    Undo works once, for your own filings, for 24 hours. The **Filed** and **No client** tabs now
    list the most recently filed first.
  - Item 19: Ask source links open in a **new tab**; file / backup-document / note-attachment /
    email-attachment sources open the document itself (PDFs in a new tab, other types download)
    instead of the client's Files tab. The source list shows the document's name.
  - Items 13 and 18: every history entry now records **who** made the change: "… · by <name>" in
    each record's Change History (client, agreement, appointment) and on the Audit Log page. Entries
    from before 2026-10-02, automatic changes and the client's own actions (signing link) show no
    name. "Marked as signed (on paper) by staff" now reads "Marked as signed (on paper)", with the
    person's name beside the time.
    Includes changes made through upload forms with no file attached (fixed 03:50 UTC after the
    re-test found "Mark as signed" with no file had no name). Audit Log type filter now also has
    Agreements, Reports, Client files, Client file folders, Session note files, Budgets, Time blocks,
    Report templates, Settings (email filing entries are under Clients).
- Item 19 (new, in production since 2026-10-02 13:55): **Ask (AI)** — sidebar Ask page, client page Ask
  button, Settings → Ask (AI) model + monthly limit, new **Ask (AI)** permission. Costs real money per
  question: max 6 questions in a run, and restore the limit (US$20) and model afterwards.
- Item 18 (new, released 2026-10-02 straight to production): Agreements → **Mark as signed** for
  paper-signed agreements, with optional signed copy upload.
- Agreements (released 2026-10-02): a **draft** has no "Reminder end date" field any more, just the
  line "Once sent, a signing reminder is emailed every 3 days for 10 days, or until it's signed."
  After sending, the signing-link box shows **Stop signing reminders after** <send date + 10 days,
  local date> and "Every 3 days until <date>"; changing the date updates that text and History.
Released to production 2026-10-02 — check these first on the next run:
- Bug fixes from the 2026-10-01 run (UAT, fixed 2026-10-01 evening):
  - Item 1: a contact with a bad email is rejected at **Save contact** on a NEW client ("… is not
    a valid email address"); any Create client failure now shows a red message by the button.
    After Create client, the new client's page shows no stale duplicate banner (a banner that
    lists only the OTHER matching client is correct). A merged duplicate's page has no
    Reactivate/Deactivate button and no duplicate banner (Undo merge only); the API refuses to
    reactivate it (409).
  - Item 13: Audit Log owner/admin/finance only; settings trimmed for non-Settings roles (see item 13).
  - Item 15: **Move back to Unfiled** (also from the All view, where the URL doesn't change)
    updates the sidebar Email number straight away.
  - Item 16: clicking anywhere in the empty compose body (not just the first line) puts the
    cursor there.
  - Item 11 accounts email: not a code change. On UAT the email is sent FROM the graph_mailbox
    setting (production's copy — ahp@i2solutions.org.au since 2026-10-01), so its Sent Items
    copy is in that mailbox, which UAT's email sync (UAT_MAIL_SYNC_MAILBOX) does not read. The
    email itself does arrive (confirmed by the user 2026-10-01): check for "[UAT TEST] Report
    billing…" in the UAT test mailbox's inbox (UAT_TEST_MAILBOX), not on the Email page's Sent Items.
- Item 1: client **Contacts** list (replaces the Emergency contact / Case manager boxes) and
  **Merge into…** for duplicate clients (with Undo merge; owners/admins only).
- Item 15: **Email** page — filing emails to clients and tags, suggestions (incl. names, nicknames,
  inactive clients), automatic filing, search highlighting; client **Communications** tab; new
  **Email** permission (practitioner/finance off by default — needs a practitioner sign-in to check).
- Item 16: writing, replying, forwarding, attachments, signature, Undo send, **Schedule send** and
  the **Scheduled** tab.
- Item 17: **Tasks** (to-do list) from email and by hand; After-sending choice; follow-ups.
- Production data changed 2026-10-01 (not code): sending address and practice email are now
  ahp@i2solutions.org.au, accounts/remittance emails accounts@i2solutions.org.au — item 11's
  accounts email goes to the new address. Man Na Adhofer, Stanley Stanton and Ross Martin had a
  shared organisation address moved from their own email to a contact (case manager in production).

Released to production 2026-09-30 — not yet covered by a full run:
- Item 3: wider appointment window, buttons on one row.
- Item 5: billing adjustments now apply to late-cancellation fees.
- Item 9: invoice numbers with letters/spaces and zero-padded display; Don't bill button;
  No charge tile/status; "Billing updated" popup that closes the window and refreshes the list.
- Item 9: overdue report invoices — Calendar banner, sidebar number, Overdue reports tile,
  Settings → Overdue Report Invoices. The **therapist view** needs a practitioner-role sign-in:
  on UAT (option A) ask the user whether they have one to sign in with, otherwise check it on a
  local copy (option B) and say which way it was checked.
- Item 10: Settings → Budget Alerts "Send to" choices (default: client's practitioners, owners,
  admins — no finance).

## Agreements, billing, compose, calendar billing run — 2026-10-08 (UAT option A, nothing sent)
Result: all 4 changes **PASS**; 3 bugs (A–C) found, all FIXED and re-tested PASS on UAT. Memory file:
`project_therapy_regression_bugs_2026-10-08.md` (sections for the run and "Re-test of bugs A–C").
Nothing was sent (no agreement sends/resends, emails, WhatsApp/SMS); no real data changed (Stuart
Nethercott #22/#23 and Joanne Cushing's Billing opened read-only).

| Check | Result | Notes |
|---|---|---|
| Agreements: budget changes after sending | PASS | Draft free; Sent/Viewed Link/Unlink/Switch/+Create budget ask first, confirm → Draft, old /sign link "no longer valid", nothing emailed; Signed/Voided controls hidden + API 409; "Sent/Signed for $X" green, amber when revised; "Create a new agreement from the current budget" → "Open the draft agreement on the current budget (#N)" |
| Bug A: paper-signed draft stored no amount | PASS after fix | Mark as signed now shows "Signed for $X"; older #27/#28 backfilled |
| Bug B: "+ Create budget" on Sent/Viewed saved before asking | PASS after fix | Asks first; Cancel creates nothing; Continue + save → Draft with the new budget linked |
| Bug C: Change History stale until reload | PASS after fix | Updates after budget action, Mark as signed, Void |
| Voided agreement signing-link box | PASS after fix | Voided shows only Download PDF |
| Client → Billing → "By discipline" | PASS | Joanne Cushing C0048, 08/10/2025–08/10/2026: OT $4,676.09; Physio $9,373.73 + $695.98 scheduled; total $14,745.80; no dropdown. "No discipline" row not testable |
| Email compose connection state | PASS | From ahp@; failing /email/status → retries ~12 s → "Therapy can't reach email right now…", Send/Schedule disabled; no false "isn't connected" |
| Reports "Add calendar billing" | PASS | Picker, "FCA 60% done" prefill, "calendar" tag, appointment leaves calendar, out-of-order/blank % rejected, Take off restores. MYOB status text for exported appointments and release on payment not tested |

Open points: real Stuart Nethercott agreement #22 is **Viewed** on UAT (mirror 2026-10-02), so the
"Open the draft (#23)" button (signed agreements only) was only seen on the ZZ equivalent; a signed-by-link
agreement still shows its "Signing link" box (decision pending with the dev session); "Resend" on a
never-exported linked report entry is by design (emails accounts). Agent cleared localStorage "draft"
keys in the UAT tab — may have removed an unsent email draft of the user.
Leftovers (can't delete): ZZ QA client 67 (inactive), agreements #27–#32, budgets #23–#29, appointments
APT-00626–629 (cancelled).

## AI features run — 2026-10-06 (UAT option A; item 19 + AI foundation, not yet in production)
Result: **mostly PASS**; 4 bugs found, all since FIXED and re-tested PASS on UAT. Bugs: memory file
`project_therapy_regression_bugs_2026-10-02.md`, sections "AI features regression — 2026-10-06",
"AI bug fixes re-test — 2026-10-06", "Nai-Shing closing sentence re-test — 2026-10-06".
Spend approved by the user; 13 questions in total (US$4.74 → US$5.27 spent this month).

| Check | Result | Notes |
|---|---|---|
| Streaming status/text, Asked/Answered times | PASS | |
| Known-answer questions (Jupiter trial 3 Sep 2026 [file 191], Bibo bed, Joanne, Jarrod annual) | PASS | Jarrod detail found deep in a long report and via the backup-zip search |
| Jupiter "end up getting" | PASS | Described as quoted; no order/delivery claim; no leading/trailing comment |
| Follow-ups, several chats at once, already-asked cards, list search/filters | PASS | "Everyone's" only checked with a single asker |
| Source links (new tab; file/zip/attachment open) | PASS | Downloads stubbed; appointment sources not exercised; non-PDF download path not testable (no such source) |
| Filing (auto, manual add/remove, inactive "- INACTIVE", Communications tab, History "· by") | PASS | Old inactive duplicate (C0003) correctly left unfiled |
| Settings → Ask limit block | PASS | After fix: one message, typed question kept, AI overview Limit cell updates after Save |
| AI overview (month by feature/model, doc counts, model per job type persists) | PASS | "Past months" not shown (no earlier data) |
| Reads only relevant pages of long documents | PASS | |
| Answer clean-up (opener/closer) | PASS after fix | Nai-Shing "not recorded" answer needed 2 fixes: closing "…search more broadly?" removed |
| Home-mod answers from the assessment, not quote line items | PASS after fix | |
| Follow-up thread flicker | PASS after fix | Sampled every ~200 ms for 35 s |
| Email list arrival times | PASS | Today "4:30 pm", earlier this year "5 Oct, 11:33 am"; older-with-year not testable (oldest email Mar 2026) |

Not tested: practitioner/Ask-only role checks for the AI changes (need a local copy), restart
mid-answer ("interrupted"), auto-filing of an inactive client, "Past months".
Settings changed and restored: Ask limit 20 → 0.01 → 20; Quick jobs model Haiku 4.5 → Nova Pro →
Haiku 4.5 (saving now stores ai_tier_models {"fast": Haiku 4.5} explicitly).
Leftovers on UAT: Ask conversations 83–92 (no delete control; all taken off the real clients they
auto-filed to, History keeps filed/removed rows); ZZ QA client 66 (inactive).
Tip for the next run: a "similar question asked before" card appears when re-asking — use "Ask anyway".

## Last full run — 2026-10-01 (UAT option A + local copy option B)
Result: **items 1–17 incl. 7b all PASS on their core flows**; 7 minor bugs (1 security), all
unfixed at the time of the run — see memory file `project_therapy_regression_bugs_2026-10-01.md`.
UAT test data on ZZ QA clients 91 and 92. Local copy covered practitioner-role checks, item 14
(by API), sending via the fake Graph server, PDF text, and item 8's required/folder/calculated checks.

| Item | Result | Notes |
|---|---|---|
| 1 Add client | PASS | Contacts, Merge/Undo merge, pagination OK. Bugs: bad-email contact makes Create fail silently (400, no message); duplicate banner stays after create and lists itself; merged duplicate still offers Reactivate + banner |
| 2 Book appointment | PASS | |
| 3 Edit appointment | PASS | Wide window, five buttons on one row |
| 4 Cancel, no fee | PASS | |
| 5 Late cancellation | PASS | Billing adjustments apply to the late fee; Don't bill / Revert OK |
| 6 Session notes | PASS | Legacy notes tested with synthetic data only (no genuine old-style notes on UAT) |
| 7 Download / email | PASS | Send never clicked |
| 7b Client files | PASS with gap | "Notify client" on Files tab not clicked (denied by classifier); the auto-opened draft email preview after Upload final report / Commit was checked |
| 8 Fill in a form | PASS | Required/folder/calculated checks on local copy |
| 9 Invoicing | PASS | Letters/zero-padded invoice numbers, No charge, "Billing updated", overdue reports (practitioner view on local copy). "Export again?" not clicked |
| 10 Templates/Settings/Reports | PASS | Budget Alerts "Send to" persisted; real templates not saved over |
| 11 Report billing | PASS, part unverified | Accounts email not seen in the test mailbox after ~25 min — check peterchen@flexisupport.com.au (possible 2026-10-01 sender change) |
| 12 Report writing | PASS | Version PDFs checked by page count only |
| 13 Audit log | PASS | |
| 14 Sign-in security | PASS (local, by API) | Lockout, forgot-password limit, 8-char minimum, reset-link invalidation, no password_hash |
| 15 Email filing | PASS | Bug: sidebar Email count stale after "Move back to Unfiled". Fresh inbound auto-filing only seen on local seed |
| 16 Email writing/sending | PASS | No real send on UAT; Undo send, Schedule send → Cancel on UAT; real send via fake Graph locally. Bug: only first line of compose body clickable. "Send now" not tested |
| 17 Tasks | PASS | Waiting→To do on follow-up date and Done/Keep after a real send not tested |

Security (low-medium, probably older): a practitioner-role login gets 200 from GET /api/audit-logs
(no permission check) and GET /api/settings (bank details, Maps key, Graph ids).

Real data touched: six real emails (shelley@qscs.com.au thread) filed to QA client 91 then moved
back to Unfiled via the app — now carry the "never auto-filed" flag. No real tasks changed.
Cleanup gaps (can't hard-delete): QA clients 91–92 (deactivated), 6 cancelled appointments,
funding periods 66–67, form response 17, 2 uploaded images, voided report entries, APT-00637
"No charge" row on MYOB Invoices, an extra billing email.

Re-test of the fixes, 2026-10-01 (post-fix, UAT option A + local copy for practitioner roles): bugs
#1, #2, #3, #4, #6, #7 all PASS, no new bugs; #5 not a code change and not verifiable from the
browser (the email goes to the UAT test inbox). Details in the bug memory file, "Re-test 2026-10-01
(post-fix)". Notes: finance and admin also get the trimmed /api/settings (default role permissions
give them no settings access); the duplicate banner on the new-client form behind the "Client
created" popup briefly lists the client itself, then disappears (cosmetic). Test leftovers: ZZ QA
clients 93–95 deactivated, task 23 Done.

## Previous full run — 2026-09-29 (UAT, option A, user's own sign-in)
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
