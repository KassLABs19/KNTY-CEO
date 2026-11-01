#!/bin/sh
# Runs once, the first time the database starts. The server connects as ceo_app, an
# ordinary user, so the database's row-level security rules always apply to it.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE ceo_app LOGIN PASSWORD '$APP_DB_PASSWORD';
GRANT ALL ON DATABASE knty_ceo TO ceo_app;
GRANT ALL ON SCHEMA public TO ceo_app;
ALTER DATABASE knty_ceo OWNER TO ceo_app;
ALTER SCHEMA public OWNER TO ceo_app;
SQL
