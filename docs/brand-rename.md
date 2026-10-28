# Tableeqr brand rename

The display name is **Tableeqr**, including the homepage wordmark, metadata, admin and staff UI, guest UI, Android Rider app labels, install manifests, print slips, receipts, PDFs, calendar exports, invitations, notifications, support messages, package names, editable marketing sources and current marketing exports.

## Compatibility identities

These existing identifiers retain their original spelling because they name deployed resources or persisted data, rather than display branding:

- Database schemas, database users, photo buckets, the currently hosted app URL and the deployed realtime Worker name. A new production hostname requires DNS and hosting attachment before the URL configuration changes.
- Android application ID and package namespace. Preserving these lets the renamed Rider app update the existing installation instead of becoming a separate app.
- The offline IndexedDB name and legacy queue prefix. Rebranding must keep pending orders, snapshots and saved drafts accessible.
- Cryptographic derivation contexts and development signing-secret fallbacks. Changing them could invalidate existing encrypted documents or signed links.
- Existing calendar event UIDs, historical release migration URLs and previously issued links.

New custom-domain instructions show `_tableeqr-verify` and `tableeqr-verify=`. The verifier also accepts the existing ownership record with the same per-outlet token. New realtime deployments prefer `TABLEEQR_API_URL`; the previously deployed secret remains a fallback. KDS auto-print preferences move to the new key on first read. Service-worker activation removes the old branded shell caches so refreshed clients receive the renamed UI.

The rename does not purchase or attach a new domain, rewrite historical customer records, or replace app packages already installed on devices. The renamed app code, Android source labels and exports still need the normal release/deployment process.

## Verification on 28 October 2026

- 26 focused branding, domain-compatibility, offline-storage and POS integration checks pass. The guard scans active app source and renders the split homepage wordmark; migration checks preserve existing DNS proof, pending orders and KDS auto-print preferences, including a full-storage case.
- Production build, main app typecheck, realtime Worker typecheck, service-worker syntax and diff checks pass. Full source lint exits successfully with seven existing warnings; generated alternate builds and temporary artifacts are excluded from lint.
- Local production-browser smoke passes for the desktop/mobile homepage, the sign-in page, browser title and fallback staff manifest (`Tableeqr Staff`), with zero browser errors and no mobile horizontal overflow. Current landing-page preview screenshots were refreshed.
- The broad test run exposed three unrelated existing UI assertions: two dashboard expectations in `test/o1-dashboard-ui.test.ts` and one exact reservation-search class expectation in `test/reservation-calendar-ui.test.ts`. Those remain separate from this rename. The branding failures found during that run were fixed and the affected checks rerun successfully.
- The current eight-page brochure and its previews, the 36-second 1080x1920 brand film, the logo cover, and the editable narration scripts use the new name. Superseded brochure/video exports were replaced.
