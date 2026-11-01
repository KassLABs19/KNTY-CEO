# Connecting the HR system and Predicto

The Control Center never reads another system's database. Each system sends signed
messages to one door, and receives signed decisions back. The message shapes live in
`packages/shared/src/contract.ts` (zod schemas); partner systems should import the same
schemas so the three code bases can't drift apart.

## Credentials

`setup:company` prints, for each partner system:

| Value | Used for |
|---|---|
| partner id | Header `x-cc-partner` on every message the partner sends |
| secret it signs with | The partner signs messages to the Control Center with this |
| secret it checks ours with | The partner checks decisions from the Control Center with this |

Then an owner sets where decisions go: `PUT /api/partners/hr` with `{ "baseUrl": "https://hr.example.com" }`
(needs the password again). Decisions are delivered to `<baseUrl>/cc/inbound`.

## Signing

Header `x-cc-signature: t=<unix seconds>,v1=<hex>` where `v1` is HMAC-SHA256 of
`${t}.${rawBody}` with the secret. Messages more than five minutes old are refused.

```ts
import { createHmac } from 'node:crypto';
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
headers['x-cc-signature'] = `t=${t},v1=${v1}`;
```

## Messages to the Control Center

`POST /api/integration/inbound`, JSON, signed. Every message has `messageId` (unique;
repeats are ignored), `system`, `contractVersion`, `sentAt` and `traceId` (keep the same
trace id in your own logs for that request).

| `type` | When | Notes |
|---|---|---|
| `request.upsert` | A request reaches its hand-off point, or changes | Send a higher `version` on every change; the Control Center's steps restart |
| `request.cancel` | Withdrawn upstream | |
| `people.event` | HR system only: `joiner`, `mover`, `leaver`, `details` | A leaver whose date has come is suspended at once |

Answers: `200` with `created`, `updated`, `ignored_old_version`, `cancelled`, `applied` or
`duplicate`; `401` for a bad signature; `400` for an invalid message; `422 not_routed`
when the current rules give the request no Control Center steps.

### Hand-off points

| Request | Partner's own steps | Control Center steps |
|---|---|---|
| Leave (department heads) | Head of HR | CEO |
| Payroll run | HR officer prepares and freezes | CFO, then CEO; locked |
| New hire | Department head, Head of HR | CFO, then CEO |
| Expense claim | Finance checks receipts | CFO (CEO if the CFO raised it) |
| Refund | Rule check before the first deadline | By amount: Head of Ops, CFO, CEO |
| Manual payment | Reference and phone checks | Head of Ops (bulk allowed when `bulkEligible`) |

## Messages from the Control Center

`POST <baseUrl>/cc/inbound`, signed the same way with the "checks ours" secret, header
`x-cc-message-id`. Only final decisions are sent: `approved`, `rejected` or `returned`
(sent back), with the `version` decided on. The partner must:

- refuse a decision whose `version` is not its current version;
- treat `x-cc-message-id` as a de-duplication key (the outbox retries until it gets a 2xx);
- refuse edits to a locked payroll run; a correction is a new version.

Retries: after 1, 5 and 30 minutes, then hourly. Owners are told if a decision is still
undelivered after six hours.

## Try it

```bash
npm run send:test -w @ceo/server -- --system predicto   # uses the demo company
```
