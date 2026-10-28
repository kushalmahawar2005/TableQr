# Tableeqr

## Local development

```bash
npm run dev
```

## Production platform admin bootstrap

The `/admin` console is protected by a signed, httpOnly cookie. The first
platform admin and the public plans are created with the non-destructive
bootstrap command below. Set these variables in the deployment environment,
not in source control:

```text
PLATFORM_ADMIN_EMAIL=admin@example.com
PLATFORM_ADMIN_NAME=Tableeqr Admin
PLATFORM_ADMIN_PASSWORD=<12-or-more-character-password>
PLATFORM_ADMIN_SESSION_SECRET=<random-secret-at-least-32-characters>
```

Then run:

```bash
npm run db:admin
```

Sign in at `/admin`. A super admin can create a restaurant, its first outlet,
owner login, zone, tables, and table QR codes. Restaurant owners then sign in
at `/console/login` using the outlet code, phone number, and four-digit PIN.

Do not run `npm run db:seed` against production; it wipes tables before loading
demo data.
