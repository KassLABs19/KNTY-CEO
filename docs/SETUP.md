# Setup

## 1. Run it on your own computer (for development)

You need **Node.js 22**, **PostgreSQL 16** and **Git**.

### Create the database

The server must connect as an *ordinary* database user. PostgreSQL superusers skip the
rules that keep companies apart, so never point the server at the `postgres` user.

```sql
CREATE ROLE ceo_app LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE knty_ceo OWNER ceo_app;
```

### Configure the server

```bash
npm install
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

| Setting | What to put |
|---|---|
| `DATABASE_URL` | `postgres://ceo_app:choose-a-password@localhost:5432/knty_ceo` |
| `JWT_SECRET` | Any random text of 32+ characters. Changing it signs everyone out. |
| `APP_ENV` | `development` (or `staging` to see the staging banner) |
| `CORS_ORIGINS` | `http://localhost:5175` (lets the desktop app talk to the server in development) |

### Fill it with demo data and start

```bash
npm run db:seed        # creates tables and the demo company
npm run dev:server     # http://localhost:8090
npm run dev:desktop    # opens the app; enter http://localhost:8090 on the first screen
npm run send:test -w @ceo/server   # optional: sends a signed test request as the HR system
```

### Run the checks

```bash
npm run typecheck
npm test
```

The server tests start their own temporary PostgreSQL if it is installed locally. If not,
set `TEST_DATABASE_URL` to an empty database owned by an ordinary user.

## 2. Set up a real company

```bash
npm run setup:company -w @ceo/server -- --company "Acme Ltd" \
  --owner-name "Hana Tesfaye" --owner-email hana@acme.com --owner-employee-id E-001
```

This prints the owner's invite link and, once only, each partner's id and secrets. Give them
to the HR system and Predicto, then set each partner's address (see
[INTEGRATION.md](INTEGRATION.md)). Use the HR system's employee id for the owner, so HR
messages about them update the same person.

## 3. Staging

Run a second server with `APP_ENV=staging`, its own database, and a separate company set up
with `setup:company`, so its partner secrets differ from production. Point it at the staging
copies of the HR system and Predicto. The app shows a staging banner on every screen.

## 4. Install on a customer's own server

The customer needs a Linux machine with Docker. From the `deploy` folder:

1. Copy `.env.example` to `.env` and fill in long random values
   (`openssl rand -base64 48` makes one) plus the `LICENCE_PUBLIC_KEY` you give them.
2. Put the `licence.json` you issued next to `docker-compose.yml`
   (see [RELEASING.md](RELEASING.md#licences)).
3. Run `docker compose up -d`, then `setup:company` inside the server container.
4. Put HTTPS in front of port 8090 (their existing reverse proxy, or Caddy).
5. Staff install the desktop app and enter that address on first launch.

Back up the `ceo-db` volume every day. If the licence expires, the server keeps running
read-only and still accepts messages from the partner systems; nothing is lost.
