# IPROG SMS notifications

The former one-recipient restriction was an application demo safeguard, not an
IPROG requirement. IPROG documents both individual and bulk SMS endpoints. This
application keeps the existing individual endpoint and submits one request per
unique Philippine mobile number, for Announcement, Interview, Schedule, and
Reminder messages.

API reference: https://www.iprogsms.com/api/v1/documentation

## Configuration

Keep `IPROG_API_TOKEN` in the backend environment (locally, `backend/.env`; on
hosting, the backend's secret environment settings). Never put it in a `VITE_`
variable, browser code, API response, or committed configuration. The existing
IPROG account still needs approval, supported routing, and sufficient credits.
These changes do not alter the account or enable a different sender.

Production uses the existing authenticated Staff session and origin controls.
Unauthenticated development access remains restricted to loopback. Do not use
the browser-only demonstration login for a public deployment.

## Sending and safeguards

- Select up to **20 beneficiaries** and enter a message of at most **480
  characters**. Search and filtered checkbox selection remain available.
- The selected list stays below Recipients, shows names and contacts, and has
  individual remove buttons. Missing records and invalid mobile numbers block
  submission. Validation never modifies beneficiary records.
- The backend reloads the selected, non-archived records and normalizes `09…`,
  `9…`, `639…`, and formatted `+63…` numbers. Beneficiaries sharing the same
  normalized number receive only one SMS in that batch.
- Send Now displays a confirmation with the message, selected beneficiary and
  unique phone counts, and estimated SMS segments. GSM-7 extension characters
  and Unicode use their respective segment limits. Provider-added text and
  encoding can change the actual credit usage; the estimate is not a price quote.
- The backend enforces a **60-second shared cooldown**, at most **three provider
  requests at once**, an **eight-second timeout per provider request**, and a
  **20-second sending budget**. Numbers not started within the budget are marked
  Not sent. There are no automatic provider retries.
- The browser saves the request identifier before submitting. Retrying an
  unresolved submission uses that same identifier. The backend's saved result
  is returned without contacting IPROG again. A pending submission is refused
  rather than sent a second time. Never work around an uncertain result by
  creating a new message before checking the IPROG dashboard.
- In production, reservations and results use the existing `SmsCooldown`
  collection alongside its cooldown document. This is SMS operational state;
  beneficiary and unrelated collections are not migrated or rewritten. Request
  identifiers are retained without automatic expiry so an old browser retry
  cannot resend a previously submitted message. An interrupted reservation older
  than 30 seconds can be recovered as Unconfirmed; recovery never resubmits it.

## Results, drafts, and history

**Queued / submitted** means IPROG returned an acceptance response and message
identifier. It does **not** confirm delivery. **Failed** means a rejection was
confirmed. **Unconfirmed** means acceptance could not be established, for
example after a timeout. **Not sent** means that number was not submitted.
Partial batches retain each number's result and the provider IDs that are known.
This application does not automatically poll delivery receipts; check IPROG's
dashboard to confirm the provider's delivery information.

Draft templates, saved drafts, message filters, deletion, and restoration remain
available. Editing a submitted message creates a draft copy. Saving or deleting
a draft sends no SMS, and deleting history cannot cancel an already submitted
message. Message history and drafts remain browser-local, as before. Activity
logs use the existing audit pipeline, record batch outcome counts and selected
record IDs, and do not claim that every request succeeded. Replayed results do
not create a second submission log. Tokens, message content, and phone numbers
are excluded from those activity entries.

## Verification and release

Automated tests inject a fake provider and fabricated phone numbers. They do
not load `backend/.env`, connect to the production database, consume credits,
or deliver SMS. From the repository root:

```powershell
node --test backend/tests/*.test.js
node --test pwd-information-frontend/tests/*.test.* pwd-information-frontend/src/utils/reportDates.test.js
```

Build the frontend from `pwd-information-frontend` with `npm.cmd run build`.
Deploy the frontend and backend changes together using the existing deployment
process; no deployment is performed by this change. The hosting function must
allow enough time for the 20-second sending budget plus database/audit writes.

Before a manually authorized live acceptance check, use controlled test
recipients in a test environment with consent and a small credit balance. Check
one recipient, multiple recipients, shared numbers, canceling confirmation,
invalid contacts, provider rejection, and uncertain responses. Confirm both the
saved history and activity-log totals. Check actual handset receipt separately
from provider acceptance. Never change real PWD records to perform these tests.
