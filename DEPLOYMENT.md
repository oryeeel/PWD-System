# Deployment and security notes

The system is local-only; nothing has been published. The Vercel and Render
instructions below are optional planning references, not an active deployment.

## Optional Vercel deployment reference

1. Create a Vercel account at https://vercel.com/signup and connect GitHub.
2. For a no-payment pilot, choose Hobby and use sample data. Hobby eligibility for
   official MSWDO operations must be confirmed with Vercel; it is intended for
   personal, non-commercial projects. Do not purchase an upgrade automatically.
3. Review and push the intended changes to the PWD-System GitHub repository.
4. Select Add New > Project, import the repository, and keep Root Directory at
   the repository root (not backend or pwd-information-frontend).
5. Use Framework Preset Other. The root vercel.json specifies installation, build,
   output, and API routing. Select Node.js 22 in project settings if available.

## Environment variables

Enter these directly in the Vercel project's Production environment. Do not paste
credentials into chat or commit .env files.

| Variable | Value |
| --- | --- |
| MONGODB_URI | Separate Atlas Free pilot database URI |
| SESSION_SECRET | Random secret of at least 32 characters |
| AUDIT_LOG_HMAC_KEY | Random secret of at least 32 bytes; retain it unchanged and securely |
| APP_ORIGIN | Exact project HTTPS URL, with no trailing slash |
| ADMIN_USERNAME | Initial administrator username |
| ADMIN_PASSWORD | Unique initial password: 8-20 characters with uppercase, lowercase, a number, and a special character |
| ADMIN_EMAIL | Initial administrator's own email address (Gmail is supported) |
| SMTP_HOST / SMTP_PORT | Email provider's SMTP host and port (587 or 465 are common) |
| SMTP_SECURE | `true` for implicit TLS (usually port 465); otherwise `false` |
| SMTP_USER / SMTP_PASS | SMTP authentication credentials |
| SMTP_FROM | Sender address accepted by the email provider |
| IPROG_API_TOKEN | Existing token, or omit it to leave SMS disabled |
| VITE_SERVER_AUTH | true (also enforced by the build command) |

Leave VITE_API_URL unset: frontend and API use the same origin. The first deploy
may establish the URL; use a temporary HTTPS placeholder for APP_ORIGIN, then set
it to the assigned stable project URL and redeploy before signing in. Preview URLs
are not implicitly trusted; use a separate preview database and matching origin
when testing previews. The initial admin is created only if no admin already exists.
Remove ADMIN_PASSWORD after confirming creation; it does not reset existing accounts.

## Create administrator and staff accounts

For an existing installation, sign in with an administrator account and open
**Users Management**. Choose **Create Admin**, enter the new administrator's
full name, username, individual email address, password, and password confirmation.
Sign out and sign in as that new administrator, then use **Create Staff**
to create each staff account with its own email address.

An email address is required for every new account and must be unique across active
and archived accounts. Gmail addresses are supported. Existing accounts without an
email can still sign in; add an address through **Edit**. Saving an address does not
verify ownership; a successful password-recovery code verifies that mailbox. Email
recovery requires the backend SMTP settings described below.

The local app uses browser-only demonstration accounts unless both `SERVER_AUTH=true`
(backend) and `VITE_SERVER_AUTH=true` (frontend) are enabled. These demo accounts are
not the shared MongoDB accounts. For shared accounts, configure `SESSION_SECRET` and
`APP_ORIGIN`, create the initial administrator with the environment variables above
or run `node scripts/seedSecureUsers.js` from `backend`, and enable both flags before
restarting the backend and frontend. The setup script creates one administrator;
create staff accounts through that administrator's Users Management page.

For a maintainer-assisted local setup, `backend/scripts/setupAdminWeb.js` provides
a temporary form bound only to `127.0.0.1`. It requires shared authentication to
already be configured. Place the desired `fullname`, `username`, and `email` in
`backend/node_modules/.cache/admin-setup/profile.json`, run the script, and open the
generated `Create Official Admin.url` shortcut in that same directory. The shortcut
contains a private setup token: keep it on the setup computer and do not share or
commit it. The user enters their password directly in the form. One successful
creation consumes the token, removes the shortcut, and closes the helper; unused
links expire after 30 minutes. Existing accounts are preserved. `status.json`
reports completion without storing a password. If creation cannot be confirmed,
inspect the account before restarting setup. This helper is never a public signup
route in the application.

An account's registered username can also be a valid email address. Email-shaped
usernames are trimmed and lowercased. Traditional usernames remain case-sensitive;
the contact email does not become a separate login alias automatically.

## MongoDB Atlas

Use an Atlas Free cluster within its storage limits for the pilot. Existing browser
users are not production accounts. Create staff accounts through the admin Users page.
Review Atlas network access for Vercel connectivity. Hobby does not necessarily have
fixed outbound IPs, so do not assume a narrow fixed-IP allowlist will work. Review
that network setup with the office before connecting real private records.
Keep demonstration records and simulated activity separate from authentic records.
Configure and test database backup/recovery before office rollout.

## Runtime behavior

- api/index.js exports the Express API as a Vercel Function.
- The frontend is served from the build output by Vercel, with SPA route fallbacks.
- Requests wait for MongoDB and initial administrator setup.
- Server-side sessions persist in MongoDB; browser headers cannot grant API access.
- A MongoDB-backed cooldown prevents parallel instances bypassing SMS throttling.
- No recurring archive timer runs in Vercel. Expired archived records are purged when
  Archived Records is opened or a restore is attempted. No scheduled cron job is added.
- Message history/drafts and report export history remain browser-local. Central
  message history still needs work before full office rollout.

## Password recovery and Admin sign-in verification

The login page's **Forgot password?** option requests a six-digit email code. Codes
are generated on the backend, stored only as keyed hashes, expire after five minutes,
and are limited to five failed attempts. A successful verification creates a
single-use, ten-minute reset authorization. Requests have a 60-second per-account
cooldown and IP rate limits. Responses do not confirm whether an account exists.
Successful email verification marks that account email as verified.
The API routes are `POST /api/auth/password-reset/request`,
`POST /api/auth/password-reset/verify`, and
`POST /api/auth/password-reset/complete`. Admin-issued temporary passwords use
`POST /api/users/:id/temporary-password`; a forced change uses
`POST /api/auth/change-temporary-password`.

Set the SMTP variables above in the backend environment. Use the provider's SMTP
credentials, not frontend environment variables. A missing SMTP configuration
disables recovery with a clear setup message. Delivery failures are logged without
email addresses, codes, credentials, or provider error details; the response
remains generic to avoid account discovery.
Live email delivery has not been verified by the automated tests. Before rollout,
send a reset to a controlled test mailbox and confirm delivery, expiry, retry
cooldown, and successful sign-in without changing production database records.

Admin sign-in now requires a fresh email code for every Admin login. Codes expire
after five minutes, allow five incorrect attempts, and can be resent after 60
seconds. Verification and login attempts are rate-limited. Codes are never returned
by the API; only their keyed hashes are stored server-side. The authenticated
session is not created until the code is accepted. Staff sign-in is unchanged.

## Selected security controls

- **Inactivity timeout:** authenticated sessions expire after 15 minutes without
  an API request and retain the existing eight-hour maximum lifetime. The session
  cookie is HTTP-only, SameSite, and secure on production HTTPS.
- **Tamper-evident Activity Logs:** the first authenticated backend startup signs
  a baseline of existing logs without rewriting their records. New entries are
  HMAC-chained and committed with the chain state in a MongoDB transaction.
  Admins can use **Verify log integrity** on Activity Logs or call
  `GET /api/activity-logs/integrity`; the result reports validity and counts,
  not log contents. Admin password-reset events are included in the existing logs.
- **HMAC key handling:** set `AUDIT_LOG_HMAC_KEY` to a random secret of at least
  32 bytes in the backend environment. Keep it private and stable; rotating or
  losing it makes integrity verification fail. HMAC detects changes relative to
  the signed baseline, but cannot protect against an attacker who controls both
  the database and application secret or deletes the chain state and all chained
  entries together. Generate a key locally with
  `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`
  and store it only in the backend environment.
- **Atlas-managed backups:** Atlas plan and cluster backup availability have not
  been confirmed from this workspace, and backups have not been enabled here.
  In Atlas, check the cluster's Backup tab, enable Cloud Backup if the plan offers
  it, choose retention, confirm a snapshot completes, and test restoring to a
  separate database before relying on it. Do not restore over the live registry
  as a test.
- **HTTPS:** the current selection is local-only, so localhost HTTP remains
  unchanged. Do not expose the local app over a network using HTTP. If a production
  host is selected later, configure TLS/HTTPS at that host, use an HTTPS
  `APP_ORIGIN`, and verify secure session cookies before entering real records.

### Optional Vercel frontend with a Render backend

The checked-in Vercel configuration can also host the backend as a Vercel Function.
If a future deployment uses Render for the API instead, configure the Render
service with `NODE_ENV=production`, `SERVER_AUTH=true`, `MONGODB_URI`,
`SESSION_SECRET` (at least 32 characters), `AUDIT_LOG_HMAC_KEY`, the SMTP
variables above, and `APP_ORIGIN` set to the exact HTTPS Vercel frontend origin. Set
`SESSION_COOKIE_SAME_SITE=none` on Render so the browser can send the secure,
HTTP-only session cookie between the separate Vercel and Render origins. Select
Node 22 for the Render service.

Set these Vercel frontend build variables:

| Variable | Value |
| --- | --- |
| VITE_SERVER_AUTH | `true` |
| VITE_API_URL | Render API origin, e.g. `https://your-service.onrender.com` with no trailing slash |

`VITE_API_URL` is an origin only; credentials remain on Render. The backend CORS
configuration permits credentials only from `APP_ORIGIN`. Use the stable production
Vercel domain, not an untrusted preview. Confirm that the browser's login response
sets a secure cookie and that `/api/auth/me` succeeds after a page refresh.

After verifying the account holder's identity, an administrator can use **Users
Management → Reset Password** for an active staff account. The backend generates
a temporary password, returns it once to the authenticated admin, hashes it in
MongoDB, invalidates existing sessions, and requires the staff member to choose a
new password at next login. The admin reset is recorded in Activity Logs. Share
the temporary password privately; do not save or send it through SMS.

Another administrator can recover an administrator account. If every administrator
is locked out, the system maintainer must restore access through the database;
there is no public administrator-recovery bypass. Changing `ADMIN_PASSWORD` does
not reset an existing account. Keep a second administrator account available.

Local demo resets change only that browser's demo accounts. Use server
authentication for shared accounts and session invalidation across devices.

## Verify after deployment

1. Signed-out /api/records must return 401 without exposing record data.
2. Sign in as the initial administrator and create individual staff accounts.
3. Verify staff cannot manage users/read audit logs and admin cannot mutate records.
4. Test create, edit, archive, and restore using sample records; refresh /reports.
5. Confirm logout revokes access and archived staff lose access immediately. Reset
   a sample staff password from Users Management: its existing sessions and old
   password must stop working, and sign-in must require a new password.
6. Test SMS only with explicit recipient and credit authorization. Automated tests
   use simulated provider responses and do not use credits.
7. Check function logs and deployment errors without sharing secrets.

## Local development

Run the backend from `backend` and Vite from `pwd-information-frontend`. For the
Mongo-backed account and temporary-password reset flow on localhost, set the
backend environment to `SERVER_AUTH=true`, `SESSION_SECRET` to a local-only value
of at least 32 characters, `AUDIT_LOG_HMAC_KEY` to a separate local-only random
secret of at least 32 bytes, and `APP_ORIGIN=http://localhost:5173`. Keep
`SESSION_COOKIE_SAME_SITE=lax` for localhost. Set `VITE_SERVER_AUTH=true` for the
frontend. The backend still needs a working `MONGODB_URI` and an existing Admin
account. Vite proxies `/api` to `http://localhost:8081`; development requests use
that local proxy even if a production `VITE_API_URL` is present.

When running locally against a shared database, start the backend with
`DISABLE_ARCHIVE_CLEANUP=true` to avoid running archive-retention cleanup during
local development. Restart both servers after changing environment variables. Local demo
authentication remains unchanged when `SERVER_AUTH` and `VITE_SERVER_AUTH` are
not enabled together. Never disable server authentication on a public deployment.

References:
- https://vercel.com/docs/functions
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/plans/hobby
