# TableQR remaining work

Snapshot: 24 October 2026. Restaurant-funded Cashfree delivery prepayment shipped in `3223a21`, and manual restaurant-QR delivery payment shipped in `e3da3d0`. The checklist tracks product work and production checks needed to call the platform complete.

## Product work (13 items; 2 complete)

- [ ] **1. Restaurant payment onboarding and live acceptance test** — Each restaurant connects its own Cashfree live account; verify credentials are encrypted, webhook signature/status checks pass, success/failure/refund paths update the bill once, and TableQR subscription Cashfree is never used for guest payments. Requires a tenant test account and its live credentials.
- [x] **2. Delivery payment by the restaurant’s UPI QR** — Customers submit a UPI reference after phone verification; authorized restaurant staff verify it before the order reaches the kitchen, and payment is recorded once in the bill ledger. COD and tenant Cashfree remain available.
- [x] **3. Manual delivery rider assignment and customer tracking** — Owners/managers can assign a rider name and phone; the customer sees “on the way” and can call the rider after dispatch. Dispatch/payment transitions remain staff-controlled and audited. A courier-provider API adapter is deferred until a provider/account is selected.
- [ ] **4. Guest entry and booking journey acceptance pass** — Walk through restaurant welcome → language → dine-in / party reservation / delivery; verify menu, availability, advance amount, tenant gateway vs restaurant QR, confirmation, cancellation/refund, and mobile navigation. Fix any missing links or confusing screens found. **Progress (24 Oct):** reservation entry now carries English/Hindi through slot selection, advance payment, confirmation, and secure booking management; booking screens have a language switch and a clear restaurant return link. Remaining: live/mobile checks for availability, tenant payment modes, cancellation/refund, and delivery.
- [ ] **5. Group guest identity and per-person bill ownership** — Verify every named/verified guest at a table is retained, item ownership and split totals stay correct, and parcel/takeaway items appear in the right bill and kitchen/packing workflow without charging other guests.
- [ ] **6. Waiter/table assignment reliability** — Verify manual assignment, free-staff load-aware auto-assignment, busy/off-duty fallback, reassignment, waiter table list, and shift visibility across Floor, Orders, Kitchen, and staff PWA.
- [ ] **7. Room guest journey and owner controls** — Verify room QR → requests/cleaning/menu → back navigation, repeat-order flow, owner-selected guest options, and Wi-Fi details; check that room-only data stays within the correct outlet.
- [ ] **8. Team invitation and staff profile completion** — Ensure every invite collects a name and phone, verifies the phone before activation, handles duplicate/incomplete invites safely, and displays the right identity and outlet in staff views.
- [ ] **9. Dynamic onboarding, feature controls, and multi-outlet isolation** — Audit that platform admins can set plan and tenant feature switches without code edits; owners can configure outlet payment/service options; verify each outlet’s menu, logo, QR, settings, and credentials remain isolated.
- [ ] **10. Tenant-branded PWA and notification UX** — Verify per-tenant name/logo/colors and install entry point, first-launch permission timing, no duplicate “allow notifications” prompt after permission is granted, and usable staff/customer screens on narrow phones. Keep platform and tenant manifests/service workers correctly scoped.
- [ ] **11. Custom-domain go-live workflow** — Complete the current TXT ownership verification with hosting domain attachment, DNS target instructions, HTTPS certificate, host-to-outlet routing, and safe fallback for unverified or expired domains.
- [ ] **12. Print output regression pass** — Check order slips, receipts, day close, GST and sales reports, QR sheets, and bills for thermal/A4 layouts, sensible margins, no blank pages, no unwanted signature line, and readable page breaks in Chrome and Safari.
- [ ] **13. Production release gate** — Run typecheck, lint, full tests, migration/build, tenant-isolation checks, and mobile/tablet/desktop smoke tests; exercise slow/offline/retry/error states for payment, booking, delivery, and staff actions. Record results before each release.

## Deferred until external approval

- [ ] Replace demo customer OTP with the approved DLT/SMS provider after sender ID, template, and credentials are ready; test delivery, resend limits, expiry, and abuse throttling before enabling it.
- [ ] Connect a courier provider after the tenant/provider and account are selected; map its assignment, tracking, cancellation, and webhook statuses to the manual dispatch lifecycle.

## Definition of done for every TODO

The UI action must connect end-to-end to the authorized server action/API and database state, enforce tenant/outlet access on the server, show loading/success/error states, work at phone/tablet/desktop widths, and have a meaningful automated test plus a real flow smoke test where external credentials or hardware are required.
