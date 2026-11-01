# Decisions

Short record of what was decided and why, so nobody has to guess later.

| # | Decision | Why |
|---|---|---|
| 1 | Packaged like the HR system: Windows desktop app, server hosted by the vendor or the customer | Same buyers, same IT setup, one way to install and update |
| 2 | Node.js + PostgreSQL rather than Firebase (the first design used Firebase) | Must install on a customer's own server; matches the HR system |
| 3 | Desktop app only; no web app | Every user is an executive, admin or head of department |
| 4 | Its own repository (KNTY-CEO), separate from the HR system | Separate product, release cycle and installer |
| 5 | Separate databases for the HR system, Predicto and the Control Center, linked by signed server calls | Each system stays usable on its own; no shared database to break |
| 6 | The HR system owns people; the Control Center owns logins and roles | One source of truth; leavers lose access automatically |
| 7 | One owner per approval step, with a fixed hand-off point per request type | Two rule sets can't disagree |
| 8 | Every request carries a version; decisions on an old version are refused | Nobody approves content they never saw |
| 9 | Outbox and inbox for every message between systems | Nothing is lost when a system is down, nothing applies twice |
| 10 | Payroll: two different signers (CFO, then CEO), locks once signed, never delegated | Basic financial control |
| 11 | Nobody approves their own request or signs two steps of one request | Separation of duties |
| 12 | Escalation only tells more people; it never hands a step to someone else | Keeps the order of signers and the two-signer rule intact |
| 13 | Refund limits start empty; until set, every refund goes to the CFO | The business sets the numbers, not the code |
| 14 | Money is stored in minor units with its currency; totals are shown per currency | No silent conversions |
| 15 | Account owners (the CEO and a backup) are the only ones who manage logins, access and settings | Control stays with the CEO |
| 16 | Two-step sign-in for owners and the CFO by default | They can approve money and change access |
| 17 | Invite links instead of passwords chosen by someone else | Only the person knows their password |
| 18 | Proprietary licence, with open-source notices kept in the repository | Commercial product that uses open-source parts |
| 19 | Warm, low-glare palette matching the HR system, with a teal accent; no dark mode | Long sessions; the two apps feel related |
