# WhatsApp Broadcast — model

Restaurants send a photo/banner + message to their own customers on WhatsApp, from their own
WhatsApp Business number. Tableeqr charges prepaid **message credits** as its service fee; Meta's
own per-message charge is billed by Meta to the restaurant's WhatsApp account.

## Money

| Who pays | What | How |
|---|---|---|
| Restaurant → Meta | Meta marketing conversation charge | Card on the restaurant's WhatsApp Business account (Embedded Signup) |
| Restaurant → Tableeqr | 1 credit per recipient message | Credit packs bought through the existing fees flow, or granted by the platform admin |

- Credits are reserved when a campaign starts sending and refunded for every recipient that was
  skipped or failed before WhatsApp accepted it. A message WhatsApp accepted is not refunded.
- Balance is the sum of the ledger; `tenants.message_credits` caches it and is only changed
  under a row lock in the same transaction as the ledger row.

## Data

```
whatsapp_accounts      one per tenant (per outlet later)
  waba_id, phone_number_id, display_phone, verified_name
  access_token (encrypted), status connected|disconnected|error
  quality_rating, messaging_tier, connected_at

whatsapp_templates     synced from Meta, or created here and submitted
  account_id, name, language, category MARKETING|UTILITY
  header image|video|none, body (with {{1}}..), buttons json
  status pending|approved|rejected|paused, rejection_reason

broadcast_campaigns
  name, template_id, header_media_url, variables json, offer_code, link_url
  segment json, outlet_id (null = all outlets)
  status draft|scheduled|sending|sent|cancelled|failed
  scheduled_at, started_at, finished_at
  audience_count, credits_reserved, credits_used, created_by_user_id

broadcast_recipients   one row per guest per campaign (unique)
  guest_id, phone, status queued|sent|delivered|read|failed|skipped
  wa_message_id (unique), error_code, error_text
  sent_at, delivered_at, read_at

message_credit_ledger  append-only
  delta (+ purchase/grant/refund, - reserve), reason, campaign_id, fee_id, actor_label, note

guests (+ columns)
  marketing_opt_out_at   set by STOP reply or staff; never re-enabled by a broadcast
  birthday (date, optional)
```

## Who receives a broadcast

Always: `consent_marketing = true`, `marketing_opt_out_at is null`, a valid Indian mobile, and
no marketing message from this tenant in the last N days (frequency cap, default 2 days).

Segments (combinable, AND):
- **All customers** of the tenant, or of one outlet
- **Came back recently**: visited in the last N days
- **Not seen lately**: last visit more than N days ago (win-back)
- **Top spenders**: total paid ≥ ₹X, or top N%
- **Visit count**: ≥ N visits (regulars) or exactly 1 (first-timers)
- **Birthday**: this week / this month (needs birthday collected)
- **Ordered delivery** / **dined in** / **booked a table**

The composer shows the live audience count and credit cost before sending.

## Sending

1. Owner/manager composes: template → photo → variables → offer code/link → segment → now or later.
2. Start: audience is frozen into `broadcast_recipients`; credits reserved in one transaction;
   refused if balance is short.
3. Worker (cron, every minute): picks queued recipients in batches within the account's Meta
   throughput tier, sends the template, stores `wa_message_id`.
4. Quiet hours: nothing is sent 21:00–09:00 outlet time; scheduled campaigns wait.
5. Cancel stops the remaining queue and refunds its credits.

## WhatsApp webhook `/api/whatsapp/webhook`

- Verify `X-Hub-Signature-256` with the Meta app secret.
- `statuses[]`: sent → delivered → read, or failed (error code stored; failed before accept = refund).
- `messages[]` with STOP / UNSUBSCRIBE / "band karo": set `marketing_opt_out_at`, reply once.
- Template status updates: approved/rejected/paused synced to `whatsapp_templates`.

## Reports

Per campaign: audience, sent, delivered, read, failed (by reason), opt-outs after it, credits
used, and visits/bills within 7 days by recipients who used the offer code.

## Admin

- Credit packs and price per credit (Plans & Pricing).
- Grant/adjust credits per tenant with a reason (audit log).
- Feature switch `broadcast` per plan/tenant.

## Phases

1. Data model, credits ledger, admin grant, segment audience preview (no Meta needed).
2. WhatsApp connect (Embedded Signup) and template sync/create.
3. Composer UI, scheduling, sender worker.
4. Webhook: delivery status, STOP opt-out, reports.
5. Credit pack purchase through Cashfree, low-balance alerts.

## Needed from Tableeqr (Meta side)

Meta Business verification, a Meta app with WhatsApp product, Tech Provider onboarding, and the
app id, app secret and Embedded Signup config id in the hosting panel.

## Version 2 — connection setup

Development branch: `codex/version-2`. Changes remain uncommitted until requested.

Configure `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_SIGNUP_CONFIG_ID`,
`WHATSAPP_GRAPH_VERSION` and `WHATSAPP_TOKEN_KEY` on the server. The token key must be
64 hexadecimal characters and must be kept stable. Only app id, signup config id and
Graph version are exposed to the browser. Tokens use AES-GCM with tenant-bound authentication.

Enable `broadcast` in the restaurant's plan/package. Owner/manager opens WhatsApp broadcasts,
enters their six-digit WhatsApp registration PIN and completes Meta signup. The server exchanges
the code, checks that the selected phone belongs to the granted WABA, registers the phone and
subscribes the app before marking the connection active. Registration/subscription failure leaves
the connection in error; disconnect clears the stored token and disables local templates.

Sync imports marketing and utility templates, including image/video headers. Missing/unsupported
templates are disabled locally; approved, rejected, paused and pending statuses are refreshed.
The in-app creation form currently submits text marketing templates with numbered-variable examples.
Media templates can be created in Meta Business Manager and imported by Sync templates.

Live verification still requires the configured Meta app, approved Embedded Signup permissions,
an actual restaurant business account, and its billing method. Automated tests use simulated Meta
responses and verify encryption, tenant isolation, registration, sync and disconnect behavior.

## Version 2 — campaign sending (Phase 3)

The owner/manager can save a draft, send now, schedule using an outlet's time zone, preview
the live audience/cost, upload a photo/banner (up to 2 MB, re-encoded as JPEG), or supply an
HTTPS image/video URL. Template body values support `{name}`, `{offer}` and `{link}`.
Dynamic URL and copy-code buttons use the template-approved structure. Only approved marketing
templates can be selected. Managers are scoped to their current outlet; owners may choose all outlets.

At activation the audience is recomputed, deduplicated by normalized Indian mobile number,
frozen into recipients and charged once under the tenant/campaign row locks. If a scheduled
audience grows beyond the approved maximum or credits run short, the campaign fails for review
without reserving credits. Customer consent, opt-out, template approval and the frequency cap are
checked again before each external send. Current preview capacity is 10,000 guest records per
tenant; larger lists fail explicitly rather than silently omitting customers.

Configure an authenticated POST to `/api/internal/broadcasts` every minute, using
`Authorization: Bearer <SERVICE_TASK_SECRET>` (at least 32 characters). The worker handles a
bounded batch, with a conservative account-wide maximum of one claim per second, 15 rounds
per invocation and a 35-second processing budget. Meta continues to enforce its current account/
portfolio limits; throttling responses back off the account for a minute. The route requires a
server allowed to run up to 60 seconds. Hosting cron setup and live sending are still deployment steps.

No sending occurs before 09:00 or from 21:00 in the campaign's saved time zone. An all-outlet
campaign uses the creator's current outlet time zone. Cancellation refunds queued recipients;
an already claimed message may finish, and its acceptance still consumes a credit. Explicit
pre-acceptance Graph rejection refunds once. Timeouts, network/5xx failures, missing message IDs
and abandoned claims move to `unknown`/Needs review, retain their credit and are never retried
automatically. The recipient ID is sent as `biz_opaque_callback_data` for Phase 4 reconciliation.

The campaign view shows queued, accepted, delivered/read, failed/skipped and Needs review counts.
This phase does not send campaign test messages to real customers during automated checks.

## Version 2 — delivery and opt-out (Phase 4)

Configure `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and register `https://<app-host>/api/whatsapp/webhook`
for WhatsApp webhook verification and `messages` plus `message_template_status_update` events.
GET verification uses the configured token. POST requests verify `X-Hub-Signature-256` against
the exact raw body using `WHATSAPP_APP_SECRET`; unverified or oversized requests are rejected.
Events are routed by the signed WABA and phone-number IDs. Delivery/read callbacks are monotonic
and safe to replay. A callback carrying `biz_opaque_callback_data` can resolve an unknown send;
when that proves Meta accepted the message, its credit remains used and the campaign can leave
Needs review. Delivery failure after acceptance is reported but does not refund a credit.

`STOP`, `UNSUBSCRIBE` and `band karo` opt out all matching phone aliases for that tenant. The
database opt-out is saved before a one-time acknowledgement is attempted. Template status events
update the locally synced template approval state. Campaign reports show sent/delivered/read and
failure totals, opt-outs after launch, guests who placed an order within seven days, and paid bills
with a recorded campaign-code redemption. POS staff can record a code only when a matching
campaign recipient is linked to the table and received the code within seven days. Redemption
records are reversible and remain auditable when staff change or remove the bill discount.

Webhook processing and signatures have automated coverage; live verification still needs Meta
app secrets and a configured webhook subscription in the hosting panel.

## Version 2 — message-credit checkout (Phase 5)

In Platform Admin → Plans & Pricing, a super admin sets the rupee price per credit, available pack
sizes and the low-balance threshold. Leaving pricing unset keeps online credit checkout disabled;
platform-admin credit grants remain available with the existing audit trail. Restaurant owners and
managers can buy one of the configured packs from WhatsApp broadcasts using Tableeqr's existing
platform Cashfree credentials. Cashfree's signed payment webhook and server-side return check are
shared with subscription checkout. Pack order IDs are idempotent; a purchase stays pending until
the exact INR amount is confirmed. Settlement locks the tenant balance and appends the credit
ledger in the same transaction, so browser return, Cashfree retry or a repeated notification cannot
add credits twice. A failed or mismatched payment adds no credits.

The broadcast page warns when the available balance is at or below the configured threshold and
shows recent purchases with a Cashfree status refresh. This is an in-app warning; email/SMS alerts
are not configured. Live purchases require Tableeqr's Cashfree credentials and its webhook set to
the existing `/api/fees/cashfree/webhook` endpoint.
