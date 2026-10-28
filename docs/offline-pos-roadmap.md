# Offline POS roadmap

Goal: staff can keep taking and settling orders during an internet outage without losing orders, sending duplicate KOTs, or silently changing the amount a guest was quoted. Work through the phases in order; each phase should be reviewed and accepted before moving to the next.

## Scope to build first

**Agreed first release:** one main installed POS device per outlet. It must keep working through an internet outage after staff has signed in and loaded the outlet data. It must show clearly what is saved only on the device, what reached the server, and what needs staff attention. Waiter/KDS devices sharing orders through a local hub are deferred until after this release.

Offline access does not bypass staff sign-in or outlet permissions. No payment is reported as successful unless the payment provider confirms it. Cash can be recorded locally for later sync; UPI/card remains pending until confirmed by its provider. KDS and printers need the restaurant LAN or a device-connected printer. Multiple devices sharing live orders with no internet needs a local restaurant hub; that is a separate architecture phase below. If both internet and restaurant Wi-Fi/LAN are down, devices cannot notify each other: guest call-waiter actions must clearly say they were not sent, never show false success, and give a physical fallback (call staff, table bell, or paper note). Reconnecting later must not deliver a stale call-waiter alert as if it were current.

## Current code and gap

The main POS is the staff web console at `/console/pos`, installable as a PWA; there is no separate native POS app today. The device queue and editable table/cart draft use outlet-scoped IndexedDB. A static `/offline-pos` shell is precached and restores the outlet snapshot only while the same cached 12-hour staff session is valid. `/console/*` document navigation failures fall back to this shell, excluding login. The online console shows a connection warning and a saved-POS shortcut. Online sign-out clears local access, snapshot, draft, and bill summary snapshots while preserving queued operations.

The saved snapshot has a last-load time and storage availability/quota warnings. A per-outlet sync lease prevents multiple tabs from draining the queue simultaneously. Staff can download a non-destructive recovery copy and import validated recovery files for the matching outlet; imports check collisions and never silently overwrite. Queued menu lines retain quoted prices and stable request IDs; price changes require explicit staff acceptance, while failed syncs back off and can be retried manually. New table/takeaway session creation is idempotent after a lost reply.

Offline cash is supported only against a bill summary previously loaded for the same signed-in staff session. It is explicitly provisional, restricted to cash, and blocked when the due amount changed, there is a pending KOT, or a provider payment is pending. The server validates the exact current due and stable request ID before settling; replay of the same ID is idempotent. Day close warns when this device has unsynced KOTs or provisional cash. A manager can inspect a queued order from another staff login that already has a server table visit, approve its exact table/items/quote, and retry it under their own account; approval is audit logged and the server binds it to that payload and user. An order that has not yet opened a server visit must be recovered by its original staff login. Closed-table, unavailable-item and price conflicts still need clear manager resolution flows. While offline, POS can now print an explicitly marked local kitchen copy through the device's browser print dialog; it is not a server KOT, and staff must hand it to the kitchen and verify paper came out. Direct silent USB/Bluetooth delivery, printer confirmation, and automatic KDS delivery remain unsupported. Official invoice numbering and tax/accounting policy also remain open.

Open items include installed-browser cold-start rehearsal, manager resolution for conflicts, printer settings/delivery acknowledgment, kitchen delivery, and the restaurant's approved invoice and day-close rules. An unavailable item or occupied table remains visible for staff review.

## Phases

### 0. Confirm the operating contract

- [ ] Record supported counter devices and browsers, and require POS install/sign-in plus one successful online data load before an outage.
- [x] Decide offline session behavior: keep the same main POS device unlocked until the existing 12-hour staff session expires; clear its offline access after online sign-out. Do not allow access after the cached expiry.
- [x] Define both outage modes: (1) internet down with outlet Wi-Fi/LAN working, and (2) internet and Wi-Fi/LAN both down. In mode 2, guest service requests are disabled with a clear notice that no new waiter call was sent, plus a physical fallback; no stale alert is queued for later delivery. This message is implemented on the guest table and order screens; real-device outage acceptance remains in phase 7.
- [x] Decide first-release device scope: one primary billing POS per outlet. Waiter and kitchen devices sharing orders offline require the later local-hub phase.
- [ ] Confirm printer types and whether each printer is connected by USB/Bluetooth to the POS device or shared on LAN.
- [ ] Confirm which offline bill types are permitted by the restaurant's billing/accounting setup. Keep non-cash payments pending until confirmed by the provider.

### 1. Offline app and data foundation

**Progress:** The POS stores its latest menu/table snapshot, pending KOTs, selected table/cart draft, and cached bill summaries in outlet-scoped IndexedDB. It displays freshness and storage/quota status. The static shell, console navigation fallback, 12-hour session-expiry gate, sign-out clearing, menu price review, recovery export/import, and local sync lease are implemented. Installed-browser cold-start acceptance, printer settings, and tax/settings reconciliation remain open.

- [ ] Use durable IndexedDB storage for outlet-scoped menu, modifiers, prices/tax settings, floor/table list, printer settings needed by POS, drafts, and pending operations.
- [ ] Make the installed POS route and required static assets reopen after a cold start without internet, while keeping staff routes and tenant data private to the signed-in device.
- [x] Add data freshness time, last successful sync time, storage availability/full warning, and a clear online/offline state.
- [ ] Define what happens when cached menu/prices/settings are stale; show the quoted cached amount and require staff review when the server amount differs.
- [x] Keep an export/backup and recovery path for unsynced orders; recovery imports validate outlet ownership and collisions.

### 2. Reliable order capture and KOT

- [x] Persist the open cart and selected table/takeaway across refreshes, app close, and device restart.
- [ ] Queue new table, takeaway, add-items, modifiers, open-item, notes, parcel and cancellation actions as durable ordered operations.
- [x] Add server idempotency for POS table/takeaway session creation and KOT creation, including the case where the server committed but the device lost the reply. Session request IDs are outlet-scoped and bound to the opening staff member and request details.
- [ ] Show separate states: saved on this device, syncing, accepted by server, sent to kitchen, and needs attention.
- [ ] Prevent accidental duplicate KOTs on double taps, retries, multiple tabs, and reconnect races.
- [x] Make price/availability changes since the last sync visible before queued items are accepted; require an explicit staff price acceptance before retrying a changed quote.

### 3. Billing and payment during an outage

- [ ] Define offline invoice numbering and provisional/final receipt behavior with the restaurant's billing rules before implementing it.
- [x] Support provisional cash collection for a previously cached bill, with staff attribution, exact-due server validation, and idempotent sync. Official offline invoice/receipt behavior still needs the outlet accounting rules.
- [ ] Keep UPI/card/provider payments pending until provider confirmation; never infer success from an offline screen or local payment selection.
- [ ] Preserve discounts, taxes, split bills, guest ownership, refunds, cancellation, and audit history through sync; route any mismatch to a clear staff resolution screen.
- [x] Day close warns that local unsynced KOT/provisional cash is excluded from the server report. Final accounting treatment still needs restaurant approval.

### 4. Kitchen and printing

- [ ] Decide which KDS screens/printers must continue to receive KOT while internet is down.
- [ ] If kitchen is on the same LAN, route orders locally from the POS/hub to KDS and network printers, with delivery acknowledgment and retry.
- [ ] Support the POS-connected printer path when LAN is unavailable; show whether a ticket printed, failed, or needs reprint.
- [ ] Prevent double printing after a lost acknowledgment and mark reprints clearly.
- [ ] Check KOT, bill, receipt and day-close layouts on the actual supported printers and paper sizes.

### 5. Sync, conflict handling and recovery

- [ ] Build a durable ordered outbox with stable operation IDs, retry/backoff, server deduplication, and observable sync status.
- [ ] Specify conflict handling for a table occupied/closed elsewhere, session expired, menu item unavailable, changed price/tax, stock changes, and two devices editing the same order.
- [ ] Keep conflicts visible and actionable; do not drop, silently rewrite, or automatically attach an offline order to another guest's table.
- [x] Show blocked-order errors, back off automatic retries, and let staff retry manually.
- [x] Allow staff to download a non-destructive JSON recovery copy of the outlet's queued orders.
- [ ] Add manager review and safe resolution tools for blocked operations. **Partial:** owner/manager approval is audited and payload-bound for queued KOTs tied to an existing server visit; unstarted orders, closed/occupied tables, and unavailable items still need resolution flows.
- [ ] Verify interrupted sync resumes after refresh, browser crash, device restart, and repeated connectivity flaps.

### 6. Multiple devices without internet (if required)

- [ ] Design and deploy an outlet-local hub/server reachable over restaurant Wi-Fi/LAN; cloud-only server actions cannot coordinate separate devices when the internet is down.
- [ ] Define device enrollment, local authentication/permissions, hub backup, updates, and behavior when the hub itself is unavailable.
- [ ] Sync POS, waiter devices, KDS and printers through the hub, then reconcile hub records to cloud with the same idempotency/conflict rules.
- [ ] Exercise router restart, split Wi-Fi networks, hub restart, cloud return, and duplicate device delivery.

### 7. Acceptance and rollout

- [ ] Walk through outage before login, outage after login, cold app launch offline, order and KOT, cash bill, pending UPI/card, printer/KDS, reconnect, app crash, full storage, server conflict, and call-waiter behavior when both internet and Wi-Fi/LAN are unavailable.
- [ ] Run at least one full-service rehearsal on the actual counter and kitchen devices before enabling it for a live outlet.
- [ ] Train staff on local-only versus server-confirmed status, pending-order recovery, payment limits, and what to do when a conflict appears.
- [ ] Release first to one outlet/device, monitor sync and conflict outcomes, then expand after acceptance.

## Numbered remaining tasks

These are the remaining first-release work items, in order. A task is complete only after its stated check passes and its result is recorded here.

### 14.1 — Installed-device offline startup

- Install the staff PWA on the agreed counter device/browser, sign in online, load POS data, then fully close the app and disable internet.
- Reopen from the installed app icon; verify same-device session access within 12 hours, cached menu/table visibility, draft persistence, and expiry/sign-out access clearing.
- Repeat with storage unavailable/full and after a service-worker/app update; confirm clear recovery guidance and no data leakage across outlets or staff accounts.
- **Pass check:** the installed app opens offline on the supported device, shows the last-sync time, preserves saved data, and rejects expired or signed-out sessions.

### 14.2 — Remaining manager conflict resolution

- Add explicit, audited resolution for a table that became occupied/closed, unavailable menu items, changed tax/price, stock changes, and recovery copies with incomplete details.
- Require a manager to confirm any table change or item removal/replacement; preserve the original recovery record and never silently move, drop, or rewrite an order.
- **Pass check:** each conflict has a safe action or clear blocked state, with matching integration coverage and no duplicate order on retry.

### 14.3 — Offline billing and accounting rules

- Confirm with the restaurant which offline receipt/bill types and tax treatment are permitted; retain provisional-only cash until the policy is documented.
- Specify offline invoice numbering, provisional/final receipt wording, split-bill/discount/refund behavior, reconciliation, and day-close treatment.
- **Pass check:** owner-approved rules are recorded and the app labels provisional versus final records correctly; UPI/card stay unconfirmed until provider success.

### 14.4 — Kitchen delivery plan

- Confirm whether offline KOT delivery is by hand-carried paper, device-attached printer, same-LAN printer, or KDS. Current browser print is a local copy only and does not reach KDS.
- If the chosen route is a supported local printer, record printer model, POS operating system/browser, paper width, connection type and delivery/reprint procedure.
- **Pass check:** kitchen receives each offline KOT exactly once or the POS visibly marks it pending/failed and staff have a verified manual fallback.

### 14.5 — Printer and print-layout acceptance

- On the actual supported device/printer, verify browser dialog, 58/80 mm choice as applicable, item/modifier/note wrapping, legibility, reprint marking, and paper-feed outcome.
- Verify normal bill/receipt/KOT/day-close layouts and clearly distinguish local offline copy from server-confirmed output.
- **Pass check:** physical paper checks are recorded for each supported setup; direct USB/Bluetooth automation is claimed only if that model/browser supports and passes it.

### 14.6 — Full outage and recovery rehearsal

- Rehearse outage after login, order/KOT capture, local print handoff, eligible cash capture, pending UPI/card, reconnect, duplicate/retry, browser crash/restart, full storage, and server conflicts.
- Separately verify guest call-waiter fallback when both internet and Wi-Fi/LAN are down; no request should falsely appear sent or arrive later as a stale notification.
- **Pass check:** every saved operation is found, resolved or clearly blocked, syncs once, and staff can explain what is local versus server-confirmed.

### 14.7 — Single-outlet release and monitoring

- Train staff on local-only status, recovery files, cash limits, kitchen handoff and conflict escalation; release to one outlet/device first.
- Monitor pending queue and failed syncs through a full service period; pause rollout if any order is lost, duplicated or silently altered.
- **Pass check:** the outlet completes a recorded rehearsal and service period before expansion.

### Deferred — Multi-device offline hub

Local hub is deliberately out of first-release scope. If the product later requires waiter, kitchen and POS devices to share live orders with internet and Wi-Fi both unavailable, create a separate numbered phase for hub hardware/software, local auth, device enrollment, cloud reconciliation, UPS/router behavior and multi-device outage acceptance.

## Verification and remaining delivery work

28 October: full suite passes: 1,110 tests passed, 1 skipped, and 0 failed across 140 files. Production build passes, including Next.js TypeScript validation. A headless Chromium PWA rehearsal confirmed the service worker controls the page and redirects a failed `/console/dashboard` navigation to `/offline-pos` after connectivity is disabled. This confirms shell fallback only; it does not simulate a real installed-device cold start. Physical device/printer acceptance remains outstanding.

Remaining first-release work is tracked as tasks 14.1–14.7 above. The multi-device local hub remains deferred. Code checks and simulated browser behavior do not replace physical-device and printer rehearsal.

## Done means

An outage rehearsal can begin from the agreed app state, create and preserve orders through a device restart, produce correct kitchen output for the agreed printer/KDS setup, record only permitted payments, sync each operation once, and leave no unresolved or hidden order. Staff can inspect and recover every pending operation. If multi-device offline is in scope, the same rehearsal passes with internet disconnected and the local hub operating.
