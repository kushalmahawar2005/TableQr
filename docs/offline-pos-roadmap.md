# Offline POS roadmap

Goal: staff can keep taking and settling orders during an internet outage without losing orders, sending duplicate KOTs, or silently changing the amount a guest was quoted. Work through the phases in order; each phase should be reviewed and accepted before moving to the next.

## Scope to build first

**Agreed first release:** one main installed POS device per outlet. It must keep working through an internet outage after staff has signed in and loaded the outlet data. It must show clearly what is saved only on the device, what reached the server, and what needs staff attention. Waiter/KDS devices sharing orders through a local hub are deferred until after this release.

Offline access does not bypass staff sign-in or outlet permissions. No payment is reported as successful unless the payment provider confirms it. Cash can be recorded locally for later sync; UPI/card remains pending until confirmed by its provider. KDS and printers need the restaurant LAN or a device-connected printer. Multiple devices sharing live orders with no internet needs a local restaurant hub; that is a separate architecture phase below.

## Current code and gap

The POS already reads outlet menu/table state from `src/server/staff/pos-terminal.ts` and sends KOT through server actions. The device queue and editable table/cart draft now use outlet-scoped IndexedDB; draft and queued KOT transitions are written atomically. The latest menu/table snapshot includes its last server-load time. A static, data-free `/offline-pos` shell is precached by the staff service worker; it restores the outlet snapshot only while the same cached 12-hour staff session is valid. Online sign-out clears the local access grant, snapshot, and editable draft while preserving queued orders. Restored carts are compared with current online menu prices before they can be sent.

Known gaps in this slice: cold-start recovery still needs an installed-browser outage rehearsal; printer settings, storage quota warnings, and manager-assisted resolution/import tools are not implemented; offline bills and cash payments are not implemented; and kitchen devices cannot see a queued order until it reaches the server. Staff can download a non-destructive JSON recovery copy of all queued orders. Queued menu lines retain their unit-price quote, compare it with fresh outlet data before a new session is opened, and carry the expected quote into the server transaction so a last-moment change blocks the KOT. Staff can explicitly accept a fresh quote and retry; failed syncs show an error, back off automatic retries, and allow a manual retry. Currently unavailable items still need manager resolution. An offline table/takeaway open carries the queued order's stable request ID; a lost response can be retried without creating a second session, while an occupied table or conflicting request remains visible for staff review.

## Phases

### 0. Confirm the operating contract

- [ ] Record supported counter devices and browsers, and require POS install/sign-in plus one successful online data load before an outage.
- [x] Decide offline session behavior: keep the same main POS device unlocked until the existing 12-hour staff session expires; clear its offline access after online sign-out. Do not allow access after the cached expiry.
- [ ] Define the expected outage: internet unavailable while outlet Wi-Fi/LAN remains available.
- [x] Decide first-release device scope: one primary billing POS per outlet. Waiter and kitchen devices sharing orders offline require the later local-hub phase.
- [ ] Confirm printer types and whether each printer is connected by USB/Bluetooth to the POS device or shared on LAN.
- [ ] Confirm which offline bill types are permitted by the restaurant's billing/accounting setup. Keep non-cash payments pending until confirmed by the provider.

### 1. Offline app and data foundation

**Progress:** The current POS screen writes its latest menu/table snapshot, pending KOTs, and selected table/cart draft to outlet-scoped IndexedDB. It displays the last server-load time while offline. The static shell, reconnect-to-authorized-route check, 12-hour session-expiry gate, sign-out clearing, menu unit-price review, and recovery export are implemented. Installed-browser cold-start acceptance, printer settings, storage quota warnings, recovery import, and tax/settings reconciliation remain open.

- [ ] Use durable IndexedDB storage for outlet-scoped menu, modifiers, prices/tax settings, floor/table list, printer settings needed by POS, drafts, and pending operations.
- [ ] Make the installed POS route and required static assets reopen after a cold start without internet, while keeping staff routes and tenant data private to the signed-in device.
- [ ] Add data freshness time, last successful sync time, storage availability/full warning, and a clear online/offline state.
- [ ] Define what happens when cached menu/prices/settings are stale; show the quoted cached amount and require staff review when the server amount differs.
- [ ] Keep an export/backup and recovery path for unsynced orders; never clear a pending order silently.

### 2. Reliable order capture and KOT

- [x] Persist the open cart and selected table/takeaway across refreshes, app close, and device restart.
- [ ] Queue new table, takeaway, add-items, modifiers, open-item, notes, parcel and cancellation actions as durable ordered operations.
- [x] Add server idempotency for POS table/takeaway session creation and KOT creation, including the case where the server committed but the device lost the reply. Session request IDs are outlet-scoped and bound to the opening staff member and request details.
- [ ] Show separate states: saved on this device, syncing, accepted by server, sent to kitchen, and needs attention.
- [ ] Prevent accidental duplicate KOTs on double taps, retries, multiple tabs, and reconnect races.
- [x] Make price/availability changes since the last sync visible before queued items are accepted; require an explicit staff price acceptance before retrying a changed quote.

### 3. Billing and payment during an outage

- [ ] Define offline invoice numbering and provisional/final receipt behavior with the restaurant's billing rules before implementing it.
- [ ] Support cash bill/payment recording offline with a durable local receipt and cashier attribution, then sync exactly once.
- [ ] Keep UPI/card/provider payments pending until provider confirmation; never infer success from an offline screen or local payment selection.
- [ ] Preserve discounts, taxes, split bills, guest ownership, refunds, cancellation, and audit history through sync; route any mismatch to a clear staff resolution screen.
- [ ] Define day-close behavior when locally recorded bills have not synced.

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
- [ ] Add manager review and safe resolution tools for blocked operations.
- [ ] Verify interrupted sync resumes after refresh, browser crash, device restart, and repeated connectivity flaps.

### 6. Multiple devices without internet (if required)

- [ ] Design and deploy an outlet-local hub/server reachable over restaurant Wi-Fi/LAN; cloud-only server actions cannot coordinate separate devices when the internet is down.
- [ ] Define device enrollment, local authentication/permissions, hub backup, updates, and behavior when the hub itself is unavailable.
- [ ] Sync POS, waiter devices, KDS and printers through the hub, then reconcile hub records to cloud with the same idempotency/conflict rules.
- [ ] Exercise router restart, split Wi-Fi networks, hub restart, cloud return, and duplicate device delivery.

### 7. Acceptance and rollout

- [ ] Walk through outage before login, outage after login, cold app launch offline, order and KOT, cash bill, pending UPI/card, printer/KDS, reconnect, app crash, full storage, and server conflict.
- [ ] Run at least one full-service rehearsal on the actual counter and kitchen devices before enabling it for a live outlet.
- [ ] Train staff on local-only versus server-confirmed status, pending-order recovery, payment limits, and what to do when a conflict appears.
- [ ] Release first to one outlet/device, monitor sync and conflict outcomes, then expand after acceptance.

## Verification and remaining delivery work

28 October: 12 focused tests pass across the IndexedDB outbox and POS server integration suites. They cover quote/retry metadata after reopening storage, non-destructive recovery export, draining consecutive queued orders in order, checkpoint/backoff recovery, stable request IDs after a lost reply, concurrent table/takeaway deduplication, and server rejection of changed menu prices before KOT creation. These checks exposed and fixed two regressions: the storage read mapper omitted quote/retry metadata, and mutating the queue during indexed iteration skipped the following order.

Four delivery workstreams remain for the agreed main-device release: complete conflict/recovery controls (including import, cross-tab coordination, and tax/settings conflicts); offline billing/cash and day close; kitchen/printer delivery; and real-device outage acceptance followed by deployment. Billing and printing are still substantial implementation work. The local hub for multiple devices is deferred. Code checks and simulated browser storage do not replace an installed-browser or physical-printer rehearsal. The current local changes and migration 0067 still need the normal live-release process.

## Done means

An outage rehearsal can begin from the agreed app state, create and preserve orders through a device restart, produce correct kitchen output for the agreed printer/KDS setup, record only permitted payments, sync each operation once, and leave no unresolved or hidden order. Staff can inspect and recover every pending operation. If multi-device offline is in scope, the same rehearsal passes with internet disconnected and the local hub operating.
