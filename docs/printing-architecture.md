# Printer management

How a Print button reaches a printer, and what Tableeqr can honestly say about it. The slip layouts
themselves are in [printing.md](printing.md); Bluetooth research is in
[printing-bluetooth.md](printing-bluetooth.md).

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Print manager | `src/lib/print/manager.ts` | One call, `print()`. Picks the printer, builds the slip for its roll, hands it to a transport, guards against double taps, reports the result. No React, no browser calls: tested on its own. |
| Transports | `src/lib/print/transports.ts` | The way a slip reaches a printer. A transport takes a finished slip and says what became of it. `browser` and `desktop_bridge` are built. |
| Job model | `src/lib/print/jobs.ts` | Kinds of slip, statuses, which status may follow which, how a status reads on screen. |
| Device choice | `src/lib/print/device-prefs.ts` | Which printer this one device uses. Stays on the device, per outlet. |
| Provider and toast | `src/components/print/` | Loads the outlet's printers once, owns the manager, shows what the last print did and what to do next. |
| Server | `src/server/print/` | Printers, assignments and the record of each print, all scoped to the signed-in restaurant and outlet. |
| Tables | `src/db/schema/print.ts` (migration `0054`) | `printers`, `print_settings`, `print_jobs`. |

## Who sets what

- **Restaurant / outlet** (Settings, managers and owners): the outlet's printers (name, 58 or 80 mm roll,
  connection) and which one is the **receipt printer** and which the **kitchen printer**.
- **Device** (Settings, any device, saved on that device only): its own receipt and kitchen printer, which
  override the outlet's. For example a kitchen tablet that always prints to the kitchen printer.
- A direct USB bridge's Windows printer name is also saved on that device, per outlet. It never goes in the shared printer record, so another tenant or terminal cannot inherit the local Windows name.
- A kitchen ticket goes to the kitchen printer. Bills, receipts, order slips and the day close go to the receipt printer.
- With no printer set up, everything still prints through the browser's print window on the device's saved roll width.

Printers belong to an outlet, so every staff device at the outlet can use the same printer. Every query is scoped
by the session's restaurant and outlet, ids sent from a screen are only looked up inside that scope, and the
database refuses a job that names another restaurant's printer.

## Statuses

| Status | Meaning |
|---|---|
| `queued` | Accepted, not yet handed to anything. |
| `sent` | Handed to the browser's print window, the operating system or the printer. Nothing says paper came out. |
| `confirmed` | The printer said it printed. Only a transport whose printer can say so can ever reach it. |
| `failed` | Could not be handed over, or the printer reported a fault. Has a code and a plain reason. |
| `cancelled` | Stopped before it was sent. |

Browser print can only ever reach `sent`. Both the manager and the server refuse to record `confirmed` for a
transport that cannot confirm. A status never moves backwards: a late report that would do so is ignored.

## Double taps, retries, reprints

- Two prints of the same thing (same kind, same table session or ticket) within 3 seconds are one: the second
  gets "already sent" and nothing is printed or recorded twice. A failed print is not held back.
- Every print has a `request_id` chosen by the screen. Reporting the same request again, from a double tap, a retry after
  a timeout, or an offline queue sent late, is the same job (`UNIQUE(tenant_id, request_id)`, and a row-lock free upsert that
  does not deadlock when many reports arrive together).
- **Try again** repeats a failed print as the same job, one attempt later.
- **Print again** is a new job linked to the first (`reprint_of`), with the slip rebuilt from current data.
- **Use browser print** after a failure prints through the browser as a new linked job.
- If the server cannot be reached, the report is kept (in memory and on the device) and sent when the connection returns.
  A refused report is dropped, not retried for ever. Printing never waits for the record.

## Permissions

Setting printers up is a Settings action: managers and owners. Printing a slip needs the role for that slip
(`printRoles` in `src/lib/staff-permissions.ts`): for example kitchen staff may print kitchen tickets but not bills,
and only managers, owners and accountants may print the day close. A kitchen wall screen, which signs in with a device
credential, may report kitchen tickets and nothing else. Checked on the server for every job.

## Adding a transport

1. Implement `PrintTransport` (`id`, `label`, `capabilities`, `availability()`, `validateConfig()`, `send()`) and set
   `implemented: true`. Say truthfully whether the printer can confirm (`confirmation: "printer"` only if it really reports).
2. Register it with `registerTransport()`. Settings lists it and a printer can then be saved with it; the manager uses it,
   falling back to browser print if `availability()` says it is not usable on this device.
3. A transport that runs on the server (network, cloud) needs a job queue: create the job first (`queued`), let the
   printer or a worker pick it up, and move it to `sent` or `confirmed` from there. `print_jobs` already holds what that needs.
4. Add tests next to `test/print-manager.test.ts`. Do not claim `confirmed` without a printer that reports it.

The planned transports (`bluetooth_ble`, `bluetooth_spp`, `network`, `cloud`) are named in the registry,
shown as "Not available yet" in Settings, and refused by the server when saving a printer.

## Records

`print_jobs` keeps one row per print and is cleared after 60 days by the scheduled job (a batch of 500 per run). It holds
what was printed (kind and a subject id such as a table session), never the slip's contents.

## Migration `0054_printer_management`

Additive: three new tables (`printers`, `print_settings`, `print_jobs`), no change to any existing table, no existing row touched.

**Rolling back the code never drops these tables.** Reverting the commits leaves them in place, empty of consequence: the
previous code ignores them (checked: the live build runs normally against a database that has them), and running
`drizzle-kit migrate` with the reverted journal, which no longer lists 0054, is a no-op (checked). Dropping them is an
optional manual clean-up, only after the feature has been off for a while and nobody needs the print history, and never part
of an automatic rollback:

```sql
-- optional, manual, later; this order
DROP TABLE print_jobs, print_settings, printers;
```

See [printer-management-deployment.md](printer-management-deployment.md) for the deploy and rollback steps.
