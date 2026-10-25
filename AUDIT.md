# TableQR full audit

Started 25 October 2026. Goal: walk every part of the product the way a restaurant and its guests will use it, and fix what is wrong before clients find it, including mistakes that do not show at first glance. `TODO.md` tracks feature work; this file tracks quality.

Work top to bottom, one part at a time. Money and guest-facing parts come first because a mistake there costs a restaurant money or a customer.

## Pinned: open items from the 25 October review (do these first)

- [x] **P1.** POS bill/receipt print has no GSTIN, FSSAI or invoice number (A6). Fixed: paid GST bills print as a tax invoice with GSTIN, FSSAI, address, invoice number and CGST/SGST per rate.
- [x] **P2.** Business-day cutoff so orders after midnight count in the right Day close and reports (A7, F5). Fixed: the cutoff comes from opening hours (an hour after the latest past-midnight closing, max 6 am); Day close, dashboard, reports and items report use it. GST stays on calendar dates.
- [x] **P3.** 58 mm thermal printer support: paper-width setting for every slip (D4). Fixed: per-device Paper 80 mm / 58 mm choice on Billing, Day close and the KDS bar; 58 mm scales the slip to fit. Also fixed: slips whose estimated height had decimals never got fitted.
- [x] **P4.** Render and check the guest receipt print `/r/[outlet]/t/[table]/paid/receipt` (A1). Done: prints on one A4 page. Fixed on all four bill documents (guest receipt, bill link, WhatsApp PDF, counter slip): city no longer repeated in the address, the same dish across rounds is one line, zero round-off hidden, GST-registered bills split CGST/SGST.
- [x] **P5.** Line-by-line review of delivery and COD: checkout, OTP, payment, dispatch, rider, refunds (B6, C6). Done: payment/bill totals use the same rounding, guest OTP and UPI-reference rules hold, staff actions are role-checked, outlet-scoped and audited, and a paid order that cannot be placed is refunded. New findings listed under B6.
- [x] **P6.** Fix the flaky `billing-flow` `beforeAll` timeout (F8). Fixed: hook timeout raised to 60 s; the reset runs every migration and seeds demo data.
- [x] **P7.** Before launch, the owner removes `OTP_TEST_BYPASS` and `OTP_TEST_PHONE` in Hostinger hPanel (B2, F9). *Owner action.* Done 25 Oct: the owner removed both variables and the bypass code was removed (revert of `0c8c5b5`).
- [ ] **P8.** UI redesign: on hold until the owner names the screens. Broken or overflowing UI found during the audit is still fixed.

## How each part is checked

Every part gets the same pass before it is ticked:

1. **Works end to end** — every button reaches the server and the database, and the result shows without a reload.
2. **Wrong input and edge cases** — empty, very long, zero, negative, duplicate, double click, two staff at once, slow network, expired session, back button.
3. **Access** — only the right role sees and does it; another restaurant or outlet can never see or change it (server-side, not just hidden in the UI).
4. **Money and numbers** — totals, tax, rounding, discounts and refunds add up; no paisa is lost or counted twice.
5. **Screen** — phone (360 px), tablet and desktop; light and dark; loading, empty, error and success states; no text cut off or overflowing; plain words a restaurant owner understands.
6. **Print** where it prints — A4 and 80 mm thermal, rendered to PDF and checked.
7. **Test** — an automated test for every bug fixed.

Findings go under the part as `- [ ] finding` and are ticked when fixed with the commit hash.

## Parts

### A. Money (highest risk)

- [x] **A1. Guest bill and online payment** — `/r/[outlet]/t/[table]/bill`, `/paid`, `/paid/receipt`, split shares, tips, pay for others, return from Cashfree, stuck payment.
  - [x] Guest receipt print not yet rendered and checked (P4).
  - [x] A guest on a restaurant's own domain who paid online came back to the main domain, where their device cookie is missing. Payment, delivery and booking returns now come back to the domain the guest is on; the booking advance no longer takes its return address from the browser.
  - [x] The mock checkout got a return address with an unreplaced placeholder.
  - [x] An online attempt nobody paid (webhook lost, guest never came back) stayed open after the minute re-check's 1-hour window, blocking reopen and paid-and-left until a manager released it. The re-check now looks back 24 hours and closes attempts the gateway has no payment for after 30 minutes, and ones that never reached the gateway after 10.
- [ ] **A2. Counter billing (POS)** — `/pos`, `/console/billing`: discounts, add items after bill asked, cash change, card/UPI, takeaway, bill/receipt print, reopen bill.
- [ ] **A3. Refunds** — staff refund flow, gateway refund webhooks, counter refunds, overpayment refunds.
- [ ] **A4. Payment webhooks and reconciliation** — `/api/payments/*`, `/api/fees/*`, minute re-check, amount checks, replay safety. *(Cross-outlet forged webhook fixed in `3b60206`.)*
- [ ] **A5. TableQR fees and plans** — `/console/plan`, admin Fees, Cashfree subscription, UPI-reference fees, trial, grace days, pause and unlock.
- [ ] **A6. Invoices and GST** — invoice numbering per financial year, tax invoice vs receipt, GST report, Excel export.
  - [x] Receipt (POS bill/receipt print) has no GSTIN, FSSAI or invoice number; required for a GST-registered restaurant.
  - [x] An outlet with no GSTIN still charged GST on its bills. Fixed (owner chose "no GSTIN, no GST"): dishes sell at 0% and open bills drop their tax until a GSTIN is set; Settings says so.
- [ ] **A7. Day close** — `/console/reports/day-close`: totals match bills and payments; print.
  - [x] Restaurants open past midnight: orders after 12 am land on the next calendar day. Needs a business-day cutoff setting.

### B. Guest side (what customers see)

- [ ] **B1. Restaurant home and entry** — `/r/[outlet]`, language choice, closed state, announcements, custom domain.
- [ ] **B2. Table QR scan and verify** — `/t/[table]`, `/verify`, OTP send/resend/expiry, join code, group at one table, table already busy.
  - [x] Remove `OTP_TEST_BYPASS` / `OTP_TEST_PHONE` from Hostinger before launch; bypass code removed too.
- [ ] **B3. Menu, item sheet and cart** — `/menu`, `/menu/item/[id]`, `/cart`: categories, photos, modifiers, veg filter, sold-out, outlet prices, order note, Hindi.
- [ ] **B4. Placing orders and order tracker** — `/orders`, `/table`: rounds, repeat order, cancellations, waiter call, realtime updates.
- [ ] **B5. Table booking** — `/book`, `/book/details`, `/book/confirmed`, `/book/manage/[token]`, `/b/[token]`: slots, advance payment (gateway and restaurant QR), preorder, cancel, reschedule.
- [ ] **B6. Delivery** — `/r/[outlet]/delivery`: area/pincode, COD, prepay (Cashfree and restaurant QR), rider tracking, closed hours.
  - [x] Delivery and COD server code not yet reviewed line by line (P5).
  - [ ] No way to cancel a placed delivery order (customer unreachable, cannot deliver); a paid one then needs a manual refund from Billing. Add Cancel with automatic refund.
  - [ ] Every delivery order adds a hidden dining-table row that is never removed; the table list grows without limit.
- [ ] **B7. Room guest** — `/room/[code]`: room requests, Wi-Fi, food to room, per-order billing.
- [ ] **B8. Waitlist** — `/r/[outlet]/waitlist`.

### C. Restaurant console (owner and manager)

- [ ] **C1. Sign-in and roles** — `/console/login`, PIN, lockout, who lands where, sign out, session expiry.
- [ ] **C2. First-run guide and onboarding** — welcome, tour, setup checklist.
- [ ] **C3. Dashboard** — `/console/dashboard`: numbers match reports, sales chart, needs-attention.
- [ ] **C4. Floor and tables** — `/console/floor`: table states, seat, move, merge, clear, take payment, print bill.
- [ ] **C5. Floor plan editor and QR sheet** — `/floor/editor`, `/floor/editor/qr-sheet`, publish safety. *(QR sheets now print several per A4, `29453e5`.)*
- [ ] **C6. Orders** — `/console/orders`, `/orders/delivery`: item list, print slip, delivery dispatch.
- [ ] **C7. Menu manager** — `/console/menu`: categories, items, photos (R2 upload), modifiers, menu library, availability, import.
- [ ] **C8. Outlet pricing** — `/console/pricing`.
- [ ] **C9. Reservations and waitlist** — `/console/reservations`, `/console/waitlist`: calendar, holds, no-shows, preorders, advances.
- [ ] **C10. Rooms** — `/console/rooms`, room QR sheet.
- [ ] **C11. Kitchen (console)** — `/console/kitchen`.
- [ ] **C12. Inventory** — `/console/inventory`: stock going down as dishes sell.
- [ ] **C13. Customers** — `/console/customers`.
- [ ] **C14. Team, shifts and invitations** — `/console/team`, `/staff/invite/[token]`: roles, shifts, duty, revoke, plan limits.
- [ ] **C15. Reports** — `/console/reports`, `/reports/items`: numbers match bills; print. *(Header alignment fixed, `29453e5`.)*
- [ ] **C16. Settings** — `/console/settings`: every section saves and reloads correctly; payment credentials; delivery setup; guest services; custom domain. *(Overnight hours allowed, `1012be5`.)*
- [ ] **C17. Multi-outlet switch** — owner switching outlets sees only that outlet everywhere.

### D. Staff apps

- [ ] **D1. Waiter app** — `/waiter`, `/waiter/assign`: tasks, bell count, table assignment, take orders, settle at table.
- [ ] **D2. Kitchen display (KDS)** — `/kds`: stations, recall, stock, sounds, KOT print and auto-print.
- [ ] **D3. Staff PWA and notifications** — install, branded icon, push on Android and iOS, permission prompts.
- [ ] **D4. Thermal printing** — KOT, bill, receipt, day close, order slip. *(Slips now fit their content, `29453e5`.)*
  - [x] Only 80 mm rolls are supported; 58 mm printers cut the right side. Add a paper-width setting.

### E. Platform admin (TableQR team)

- [ ] **E1. Admin sign-in and dashboard** — `/admin`.
- [ ] **E2. Tenants and onboarding** — create restaurant, outlets, trial, status, custom package.
- [ ] **E3. Plans and features** — plan limits really switch features on and off everywhere.
- [ ] **E4. Fees, subscriptions, analytics, audit log, settings**.

### F. Under the hood (mistakes that do not show)

- [ ] **F1. Tenant and outlet isolation** — every server query scoped; no cross-restaurant read or write.
- [ ] **F2. Security** — auth on every server action and API, rate limits, CSP, file uploads, secrets, OTP abuse.
- [ ] **F3. Database and migrations** — migrations run cleanly on the live database at start; indexes for busy queries.
- [ ] **F4. Realtime and polling** — screens update without reload; recover after network loss.
- [ ] **F5. Time zones and dates** — outlet time zone everywhere; midnight, month end, financial year end.
- [ ] **F6. Performance** — guest menu load on slow 4G, image sizes, big menus, many tables.
- [ ] **F7. Errors and logging** — no raw error text shown to users; failures logged.
- [x] **F8. Tests** — `billing-flow` integration suite sometimes times out in `beforeAll` when the full suite runs.
  - [ ] `g6-flow` "isolates table sessions" failed once in a full run and passed alone; watch for a repeat.
- [ ] **F9. Production setup** — Hostinger env complete, build, backups, domain and HTTPS.
