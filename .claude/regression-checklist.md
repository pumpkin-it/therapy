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
duplicate-detection warning banner appears (non-blocking).

## 2. Book an appointment
Calendar → New appointment → pick Practitioner, Client, Funder (if the client has funding
periods), Start/End time, a real Service line item → Save → appointment appears on the
calendar at the right time/day, correct color per practitioner.

## 3. Edit an appointment
Open an existing appointment → change time and/or a line item → Save → change persists on
reload (close and reopen the appointment, confirm the new value is still there — not just
optimistic UI).

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

**Known tool limitation**: when cancelling an appointment far enough out that no cancellation
tier applies, the dedicated button's `del()` falls into a branch that calls native
`window.confirm('Cancel this appointment?')`, which the Claude Browser pane tool suppresses and
auto-answers "false" — the console shows `Page dialog suppressed (confirm): ...` when this
happens. This means the confirmation-popup half of *this specific* (no-fee, no-tier) cancel
path **cannot currently be verified through this tool** — every automated attempt will silently
abort at the `confirm()` call. Item 5 below (cancelling within the policy window) does NOT hit
this limitation — it uses a custom in-app confirmation instead — so prefer item 5 to verify the
popup itself actually still works, and only use this item to confirm the plain-cancel
status/badge behavior via the Status-dropdown proxy path, without expecting the popup to appear
that way. Until the app is changed to use a custom modal here too (or the tooling gains dialog
handling), treat the popup step of this specific item as **not automatable — verify manually**.

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
To Export** (or To Send) and confirm this appointment appears with a **non-zero amount** that
correctly reflects the fee-percentage line **plus** any travel/km/notes lines (this is exactly
the combination the historical bug dropped — don't just check that *an* amount shows, check that
travel/km/notes weren't silently zeroed).

**Unbilled**: click "Cancel appointment" on a second same-window appointment → at the same
policy prompt, click "Go back" / decline the fee instead → confirm it shows the plain **"C"**
badge (not "LC") → confirm this appointment does **NOT** appear on Invoices → To Export at all
(cancelled + not billable should be fully excluded from the outstanding-to-bill list, unlike the
billed case above).

## 6. Session notes — add, from both entry points
- Via the appointment modal's own Session Notes section: add a note, Save → appears in the list.
- Via the client profile's Session Notes tab: add a note, Save → appears in the list.
Both entry points write to the same place — a note added one way must be visible the other way
(open the same appointment/client from both sides and confirm).

## 7. Session notes — download / email
Select a note (appointment modal or client profile, both have this) → Download PDF succeeds
(real 200 response, real PDF bytes) → the PDF's date matches the actual session date, not
today. Email button opens the pre-filled modal with the correct recipient/subject/body,
including the same correct session date in the body — **do not actually click Send** (would
dispatch a real email); confirming the pre-filled preview is correct is sufficient.

## 8. Fill in a form
Client → Forms → Fill in a form → pick a template through the folder picker (if the template
list has folders, confirm it's still navigable, not just a flat list) → leave a required field
blank and try Save → blocked with the missing fields highlighted → fill everything in → Save
succeeds → reopen the saved response, confirm the answers persisted correctly (including any
calculated/derived field, e.g. LEFS's auto-summed total).

## 9. Invoicing — reach the confirm step
Invoices → To Send (or To Export, depending on `invoicing_mode`) → open a real unbilled
appointment → confirm the line items and total look right. Do not actually complete a real MYOB
export or send a real invoice email unless the user has explicitly asked for that as part of
this run.

**Note on `export_only` mode** (confirmed 2026-09-14): there is no separate confirm/preview
screen in this mode — clicking "Export MYOB CSV" is a single action that immediately calls the
export endpoint and stamps the appointment as exported. In this mode, **stop at "select the row
and verify the line items/total in the list view"** — do not click Export, since that would
complete a real (if harmless, QA-only-data) export rather than just previewing it.

## 10. Templates & Settings pages load cleanly
Templates page — all four tabs (Email, Session Note, Agreement, Forms) load without a console
error, consistent full-page width. Settings page loads. Reports page loads and returns data for
a normal date range.

---

## Standing rules for whoever runs this (human or agent)
- Run against **UAT** (`https://therapy-uat.pumpkinit.com.au`), never production, unless the
  user explicitly asks for a specific check to be run against production too.
- Use a **throwaway QA practitioner account**, created directly via a script on the UAT
  database (see `project_therapy.md` / `feedback_therapy.md` memory for the established
  pattern) — never reuse or overwrite a real practitioner's credentials.
- Never actually send a real email or complete a real financial transaction during this run —
  stop at the confirmation/preview step for anything like that.
- Clean up every piece of test data (notes, appointments, clients, the QA account itself)
  created during the run before finishing, regardless of pass/fail outcome.
- Report a clear pass/fail per checklist item, not just an overall verdict — flag anything that
  didn't fully match "what still works" above with enough detail to reproduce.
