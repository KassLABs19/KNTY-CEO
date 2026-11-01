# What comes next

The foundation, sign-in, Overview, Approvals, Logins & people and Audit log screens are in place. Each item
below is designed in the Control Center mockup and the build spec. Suggested order:

1. **Invite emails** — today the owner copies the one-time link and sends it. Add sending by
   email (the HR system's mail settings, or an SMTP setting) with the link never stored.
2. **Access & roles screen** — the access matrix grouped by system, with a sticky first
   column. Server: `PUT /api/roles/:id` (levels through `sanitizeLevels`, password again),
   custom roles, and "View as" (client-only, read-only).
3. **Settings screen** — approval rules (`PUT /api/settings/rules` exists), partner
   addresses (`PUT /api/partners/:system` exists), locale and currency display, delegation.
4. **Salary reveal** — `POST /api/requests/:id/reveal` fetching the value from the HR system
   on demand (`GET <hr>/cc/reveal`), Manage on payroll plus password again, logged on both sides.
5. **Payroll payment file** — download once locked, watermarked, logged.
6. **Nightly check** — call each partner's `GET /cc/open`, compare open requests, store the
   result in `partners.last_reconcile`, alert owners on any mismatch, re-send latest state.
7. **Notification channels** — Telegram and browser push through one router, per-person
   preferences and a daily digest. Today alerts are in-app only.
8. **Emergency access** — two keyholders with sealed single-use codes; 4-hour owner access,
   everyone notified, every action tagged. Drill in staging every 6 months.
9. **Partner secret rotation** — two active secrets per partner during a change-over.
10. **"Open in HR system / Predicto"** — one-time 60-second hand-over token.
11. **macOS and Linux builds** — add targets to `electron-builder.yml` and release jobs.
12. **Shared contract package** — publish `packages/shared/src/contract.ts` as its own
    versioned package that the HR system and Predicto import.

Open questions for the business:

- Refund limits for the Head of Operations and the CFO (until set, every refund goes to the CFO)
- Whether department heads' leave should stop at the Head of HR instead of the CEO
- Which roles besides owners and the CFO need two-step sign-in
- Who holds the emergency recovery codes
- Whether payroll signing may ever go to a named second signer while the CEO is away
