# KNTY CEO

The company control center: one place where the CEO, CFO, heads of department and admins
see what needs a decision across the **HR system** and **Predicto**, approve it, and
control who can do what.

It comes in two parts:

| Part | Who uses it | Where it runs |
|---|---|---|
| **Desktop app** | CEO, CFO, heads of department, admins (whoever the CEO invites) | Installed on Windows PCs (macOS and Linux later) |
| **Server** | — | The vendor's cloud, or the customer's own server |

There is no web app and no self sign-up. Account owners invite people, and only people
who exist in the HR system can be invited.

## What works today (foundation + first screens, version 0.1.0)

- **Sign-in** with invite links (`kntyceo://invite/…`), two-step sign-in for owners and
  roles that need it, account lock after repeated wrong passwords, sign-out after 30 idle
  minutes, password asked again before sensitive actions
- **Overview**: what's waiting on you, key counts, money waiting per currency (never
  converted), and the health of the links to the HR system and Predicto
- **Approvals**: one inbox for requests from both systems, with
  - one owner per step: the partner system runs its own steps, the Control Center the rest
  - payroll needs two different signers (CFO, then CEO) and locks once signed
  - nobody approves their own request, and nobody signs two steps of one request
  - send back for changes (with a note), approve, reject
  - decisions on an old version are refused ("changed upstream")
  - delegation while away; payroll is never delegated
  - bulk approval for payments the partner already checked
  - reminders and escalation; nothing is ever approved automatically
- **Partner link**: signed messages in both directions, de-duplicated, versioned, with an
  outbox that retries until the partner confirms; HR joiner, mover and leaver events
  keep logins in step (leavers are suspended at once)
- **Audit log** that cannot be edited or deleted, with trace ids and a CSV export that
  carries the downloader's name
- **Companies kept apart** inside the database (row-level security)
- **Signed licences** for self-hosted servers (read-only mode if expired)
- **Automatic updates** for the Windows app from GitHub Releases

Logins & people, Access & roles and Settings have their server endpoints in place; their
screens come next. See [docs/NEXT.md](docs/NEXT.md).

## Try it on your computer

See [docs/SETUP.md](docs/SETUP.md). In short: install Node.js 22 and PostgreSQL 16, then

```bash
npm install
cp apps/server/.env.example apps/server/.env   # then edit it
npm run db:seed
npm run dev:server     # API on http://localhost:8090
npm run dev:desktop    # desktop app window; first screen asks for http://localhost:8090
```

Demo accounts (password `demo-password-2026`):

| Email | Role |
|---|---|
| `hana@demo.local` | CEO, account owner (sets up two-step on first sign-in) |
| `mekdes@demo.local` | CFO (two-step) |
| `yonas@demo.local` | Head of HR |
| `liya@demo.local` | Head of Operations (away: delegated to Hana) |
| `ruth@demo.local` | Department head, Sales |

## Find your way around

```
packages/shared   Roles, approval rules, the partner contract and API shapes
apps/server       The API (Node.js, Fastify, PostgreSQL)
apps/desktop      The Windows app (Electron + React)
deploy            Files for customers who host it themselves
docs              Setup, architecture, integration, releasing, decisions, next steps
```

| Read this | When you want to… |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | run it locally or install it on a server |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | understand how the parts fit and why |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | connect the HR system or Predicto |
| [docs/RELEASING.md](docs/RELEASING.md) | ship a new version of the Windows app |
| [docs/DECISIONS.md](docs/DECISIONS.md) | see what was decided and the reasons |
| [docs/NEXT.md](docs/NEXT.md) | pick up the next piece of work |

## Licence

Proprietary. See [LICENSE](LICENSE). Open-source components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
