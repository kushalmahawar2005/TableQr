# Production operations runbook

## Before a release

1. Run `npm run lint`, `npx tsc --noEmit`, and `npm test` against the dedicated local test database.
2. Run `npm run security:preflight` with the production environment loaded. It reports configuration state, not secret values.
3. Take a fresh database backup in Hostinger before any release that changes the schema. Confirm the backup completed and that the latest backup can be restored to a separate test database on a regular schedule.
4. Check that `SERVICE_TASK_SECRET`, database settings, payment credentials, storage credentials, and the persistent encryption/VAPID keys are set on the app and scheduler where required. Keep `PAYMENT_CREDENTIALS_KEY` unchanged while encrypted restaurant gateway credentials exist.

## Deploy and check

1. `npm run build:production` runs Drizzle migrations before building. A migration or build failure should stop the release.
2. At app startup, the server applies the idempotent compatibility steps in `src/server/ensure-schema.ts` before Next accepts requests. A schema failure is now fatal to that server process; check the `[schema]` log metadata and fix the database issue before restarting.
3. Check the startup log for `[db] connection pool size`. The default is 10 connections per Node process, and `DB_POOL_SIZE` is capped at 12. Set it lower when running multiple workers so their combined connections fit the database user's limit.
4. Check `/api/health` returns HTTP 200 and `{"status":"healthy","database":"connected"}`.
5. Check the scheduler calls `/api/internal/service-tasks` every minute with the matching bearer secret. A non-200 response or a positive `failedOutlets` count needs investigation; the endpoint response contains only aggregate counts.
6. Smoke-check one guest order, one staff order/payment, kitchen ticket visibility, and a booking on a test outlet. For releases touching payments, verify a test-mode gateway payment and refund end to end.

## If a release causes an error

1. Preserve the first failing build/startup/request log and its route or error digest. `[request-error]` records route, render type, and safe database error metadata; it intentionally omits URLs, SQL, and parameter values.
2. If the build fails before deployment, the current running release should remain in place. Fix the build or migration issue and retry after checking the backup.
3. If a deployed release fails, roll application code back to the last known-good commit and redeploy. Database migrations are not automatically reversed by a code rollback; leave additive columns and tables in place unless a reviewed data migration specifically requires another action.
4. Restore a database backup only when data is damaged or the migration is destructive, and only after stopping writes and confirming the restore point. Never use `DROP TABLE` as a routine rollback for additive migrations.
5. Recheck `/api/health`, the scheduled job, and the affected flow after recovery.

## What code checks do not prove

- `/api/health` checks database reachability, not Cashfree's live event delivery or the scheduler's external configuration.
- Integration tests use a dedicated test database and mock/sandbox gateway behavior. Production payment events, backup restoration, host limits, and real printer output require their own live checks.
- Performance should be assessed using production request latency, database connection use, and slow-query measurements. Local test data cannot establish multi-tenant production capacity.
