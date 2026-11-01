# How it fits together

```
  Windows app (Electron)                 HR system ──┐
  CEO, CFO, heads, admins                            │ signed messages
          │                              Predicto ───┤ both ways
          │ HTTPS + JSON API                         │
          v                                          v
   ┌──────────────────────────────────────────────────────┐
   │  KNTY CEO server (Node + Fastify)                    │──► PostgreSQL
   │  approvals · people sync · outbox · audit            │    (one database, many companies,
   └──────────────────────────────────────────────────────┘     kept apart by row-level security)
```

## The pieces

**packages/shared** holds everything that must mean the same thing everywhere: the access
matrix (modules and levels), the built-in roles, how each kind of request is routed
(`consoleChain`), the partner contract (zod schemas for every message), money helpers,
API shapes, a small API client and the colour palette (`theme.css`).

**apps/server** is the only part that touches the database.
- `src/auth/` — sign-in, two-step codes, session tokens, invites, password re-entry
- `src/guard.ts` — checks the token on each request and reloads the person and role, so a
  suspension or access change applies at once
- `src/approvals.ts` — the approval engine: who may act, decisions, new versions, the outbox
- `src/people.ts` — joiner, mover and leaver events from the HR system
- `src/integration/` — the signed inbound door, signature checks and outbox delivery
- `src/jobs.ts` — outbox delivery every 30 s; reminders, escalation and due leavers every 15 min
- `src/routes/` — the API endpoints
- `migrations/` — numbered SQL files, applied in order at start-up

**apps/desktop** is Electron. `electron/main.ts` owns the window, keeps the server address
and the saved sign-in (encrypted with Windows' own key store), opens invite links and checks
for updates. The page runs sandboxed and can only reach what `electron/preload.ts` exposes.

## One request, end to end

1. A request starts in the HR system or Predicto, which runs its own steps.
2. At the fixed hand-off point, the partner sends `request.upsert` (signed, with a version).
3. The server builds the Control Center's steps from the company's rules and tells the
   people who can act.
4. Each decision is checked in one locked transaction: right version, right person, not the
   requester, not someone who signed an earlier step, password re-entered if the kind needs it.
5. The final decision (approved, rejected or sent back) goes into the outbox in the same
   transaction. The worker delivers it, signed, and retries until the partner confirms.
6. If the partner changes the request meanwhile, it sends a higher version: the Control
   Center's steps start again and older decisions are refused.

## Security choices, in plain words

| Risk | What stops it |
|---|---|
| One company sees another's data | Every table has a database rule that hides other companies' rows, even if the code forgets a filter |
| Someone approves their own request | The requester is never an approver; their step goes to the next holder or an owner |
| One person signs payroll alone | Two steps, two different people; nobody can sign two steps of one request |
| A delegate signs payroll | Payroll is never delegated |
| A decision applies to changed content | Decisions carry the version; a newer version restarts the steps |
| A message is lost or applied twice | Outbox with retries; inbox de-duplication by message id |
| A forged partner message | HMAC signature with a per-partner secret; messages older than five minutes refused |
| Someone who left keeps access | The HR leaver event suspends the login and signs them out everywhere |
| Stolen owner password | Two-step sign-in, and the password again for payroll, rules and partner addresses |
| Someone edits history | The audit log refuses updates and deletes at the database level |
| A customer edits their licence | Licences are signed with a key only the vendor holds |

## Sessions

1. Sign-in returns a 15-minute access token and a refresh token.
2. The desktop app keeps the refresh token encrypted; each use swaps it for a new one.
3. After 30 minutes without activity the app signs out and the server refuses the old token.
4. Sensitive actions need a 5-minute "password again" token tied to the session.

## Updates

- **Windows app:** on start and every 4 hours it checks GitHub Releases, downloads quietly and
  installs on restart. The server can refuse versions older than `MIN_DESKTOP_VERSION`.
- **Server:** a new Docker image. Migrations run automatically on start.
