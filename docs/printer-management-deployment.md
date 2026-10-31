# Deploying printer management

Live commit before this work: `4679e18`. This work adds `fcbd42d` (slip layouts), `e072a70` (printer management) and
`5ef08cb` (hardening after the safety review), plus this documentation commit. Migration `0054` (additive, three tables).

## Before

1. A fresh production database backup (hPanel, Databases).
2. `git fetch` and confirm `origin/master` is still `4679e18`. If it moved, stop and review what came in.
3. `git log --oneline 4679e18..printer-management` shows only the commits above. No attendance files, no `.env` files.

## Deploy

1. `git switch master && git merge --ff-only printer-management` (master is already at `fcbd42d`, an ancestor, so this is a
   fast-forward), then `git push origin master`. Push nothing else.
2. Hostinger builds from master: `npm run build:production` runs `db:migrate` first, which creates the three tables in about
   a second, then builds. If the migration fails the build stops and the running site is untouched.
3. Watch the build to `completed`, then the startup log (`[db] connection pool size 10` by default; capped at 12 per app process), then `/api/health` (HTTP 200,
   `database: connected`).

## Check by hand (a manager signed in on a phone or computer)

1. Settings: a **Printers** card appears. Add "Counter printer", 80 mm, Browser print. Press **Test print**: the print window
   opens with a ruler line; both ends of the line should show on paper.
2. Assign it as the receipt printer and add a "Kitchen printer" for the kitchen. Reload; the choices stay.
3. Billing: print a bill and a receipt. A small notice says **Sent**, and that Tableeqr cannot confirm paper came out.
4. Kitchen screen: print a ticket from a card. Turn on auto-print on one screen only, place an order, and confirm exactly one
   ticket prints.
5. Day close: Print. Check "DAY SUMMARY" for today and "DAY CLOSE REPORT" for a past day.
6. Fallback: block pop-ups for the site and print again; it should still print (through a hidden frame). In Settings, **Recent prints**
   lists each one as Sent.
7. Remove the Printer: slips print through the print window as before.

In the browser's print window: Headers and footers off, Margins None, Scale 100%, paper size to match the roll.

## Rollback

Any of: a Print button that does nothing, Billing, Kitchen or Settings erroring, a failed build.

- Everything (back to `4679e18`): `git revert --no-edit <docs> 5ef08cb e072a70 fcbd42d` then push. Hostinger redeploys.
- Only printer management, keeping the slip layouts: `git revert --no-edit <docs> 5ef08cb e072a70`, then push.
- **Leave the three tables in place.** The old code does not use them, and the redeploy's `db:migrate` finds nothing to do
  (the journal no longer lists 0054; both were rehearsed). Do not run `DROP TABLE` as part of a rollback.
- After a rollback: `/api/health`, then print a bill, a kitchen ticket and the day close.

To go forward again after a rollback, revert the revert commits; `db:migrate` finds 0054 already applied and does nothing.

## The 60-day clean-up

`print_jobs` older than 60 days are deleted, 500 at a time, by the scheduled `/api/internal/service-tasks` call. That call is made every
minute by the Cloudflare Worker `tableqr-realtime` (`triggers.crons` in `realtime/wrangler.jsonc`), which needs the secrets
`TABLEEQR_API_URL` and `SERVICE_TASK_SECRET` (the existing `TABLEQR_API_URL` secret remains supported during migration). If they are not set on the Worker, nothing runs and the table only grows (about 50 MB a
month for 30 restaurants). It does not affect printing. To check, in Cloudflare open the Worker, **Triggers** (the cron) and **Logs**; or
run once from a trusted computer, which returns a small JSON summary:

```
curl -s -X POST -H "Authorization: Bearer $SERVICE_TASK_SECRET" https://<your-app>/api/internal/service-tasks
```

When it clears records the app logs `[service-tasks] cleared N old print records`.
