# Vercel deployment

Nothing has been published. Vercel is the selected host; Render is not required.

## Account and project

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
| APP_ORIGIN | Exact project HTTPS URL, with no trailing slash |
| ADMIN_USERNAME | Initial administrator username |
| ADMIN_PASSWORD | Unique initial password, 12-72 characters |
| IPROG_API_TOKEN | Existing token, or omit it to leave SMS disabled |
| VITE_SERVER_AUTH | true (also enforced by the build command) |

Leave VITE_API_URL unset: frontend and API use the same origin. The first deploy
may establish the URL; use a temporary HTTPS placeholder for APP_ORIGIN, then set
it to the assigned stable project URL and redeploy before signing in. Preview URLs
are not implicitly trusted; use a separate preview database and matching origin
when testing previews. The initial admin is created only if no admin already exists.
Remove ADMIN_PASSWORD after confirming creation; it does not reset existing accounts.

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
  message history and password recovery still need work before full office rollout.

## Verify after deployment

1. Signed-out /api/records must return 401 without exposing record data.
2. Sign in as the initial administrator and create individual staff accounts.
3. Verify staff cannot manage users/read audit logs and admin cannot mutate records.
4. Test create, edit, archive, and restore using sample records; refresh /reports.
5. Confirm logout revokes access and archived staff lose access immediately.
6. Test SMS only with explicit recipient and credit authorization. Automated tests
   use simulated provider responses and do not use credits.
7. Check function logs and deployment errors without sharing secrets.

## Local development

Run the existing backend and Vite commands as before. Vite proxies /api to port 8081.
Local demo authentication remains unchanged unless SERVER_AUTH=true and
VITE_SERVER_AUTH=true are explicitly enabled. Never disable server authentication
on a public deployment.

References:
- https://vercel.com/docs/functions
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/plans/hobby