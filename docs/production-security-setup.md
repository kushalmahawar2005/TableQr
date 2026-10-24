# Production security and OTP readiness

## Current status

- Hostinger has the three staff-push variables configured. The actual values are masked by Hostinger and were not read or changed.
- The production database migration journal contains all 48 repository migrations, including `0047_serious_iron_man` for platform-admin login throttling.
- Production has an OTP signing secret configured, but no Fast2SMS provider variables are present. Therefore the production SMS sender correctly fails closed instead of generating or returning demo OTPs.
- The local `.env.production` file is a separate deployment aid and does not mirror Hostinger's settings. Never commit it.

## Configure SMS after DLT approval

In Hostinger hPanel, add these server-side variables to the Node.js app:

```text
SMS_PROVIDER=fast2sms
FAST2SMS_API_KEY=<Fast2SMS API key>
FAST2SMS_OTP_TEMPLATE_ID=<approved OTP template ID>
FAST2SMS_OTP_EXPIRY_MINUTES=5
```

The DLT OTP template must contain the OTP variable in the format Fast2SMS expects. TableQR generates and hashes the OTP itself, then sends that code to Fast2SMS; verification remains inside TableQR, so the existing per-phone, device, table, and wrong-code limits still apply. The API key stays on the server and is sent only in Fast2SMS's Authorization header. Provider failures never fall back to demo codes.

The Fast2SMS OTP endpoint accepts an OTP template ID, Indian mobile number, app-supplied OTP, and expiry. Confirm the approved template ID and variable mapping in the Fast2SMS panel before enabling the variables.

## Validate before deployment

Run:

```bash
NODE_ENV=production npm run security:preflight
```

This reports only pass/fail state and safe configuration hints. It never prints secret values. It checks the OTP secret, VAPID key shape, Fast2SMS settings, and whether the configured database has all migrations in the repository journal. Run it from a host that can reach the target database and has the target's environment variables loaded.

The code changes require a new production build/deploy to activate the Fast2SMS adapter. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is build-time configuration for the browser bundle, so a change to it requires rebuilding. The production migration check already passes; do not rerun migrations just for this task.

## Staff push

Staff push uses the existing VAPID key pair configured in Hostinger. Keep the same pair across deploys and app instances. A browser permission prompt still requires a user gesture and cannot be forced by the app at install time.

## Restaurant custom domains

Set `CUSTOM_DOMAIN_CNAME_TARGET` in the deployed Node.js app to the exact DNS destination Hostinger shows for that app. If left empty, the settings screen suggests the hostname in `PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_URL`; use Hostinger's value if it differs. For each restaurant, the owner adds the domain to the same app in hPanel, publishes the displayed ownership TXT record plus the host's required CNAME/ALIAS record, waits for Hostinger's HTTPS certificate, opens the guest link and confirms the right restaurant loads, then enables the custom URL in TableQR settings. Keep the TXT proof record in DNS: TableQR checks it with a short cache and redirects unavailable, unverified, or disabled custom-domain requests to the configured public app URL. Set `PUBLIC_APP_URL` to the canonical TableQR app origin so that fallback always has a destination.

## References

- Fast2SMS [Send OTP API](https://docs.fast2sms.com/reference/send-otp)
- Fast2SMS [DLT OTP template guidance](https://www.fast2sms.com/help/how-to-get-dlt-template-id-for-otp-and-transactional-sms/)
