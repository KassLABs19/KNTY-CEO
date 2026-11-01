# Releasing

## A new Windows app version

1. Change `"version"` in `apps/desktop/package.json` (for example `0.2.0`).
2. Commit, then tag and push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```
3. GitHub Actions ("Release Windows app") builds `KNTY-CEO-Setup-0.2.0.exe` and publishes it
   as a GitHub Release. Installed apps download it and install on restart.

The tag must match the version number, or the build stops on purpose.

### Rolling out in waves

Edit `latest.yml` in the GitHub Release after it is published and add `stagingPercentage: 20`.
Raise it to 100 when you are happy.

### Forcing an update

Raise `MIN_DESKTOP_VERSION` on the server. Older apps must update before they can sign in.

### Code signing

Without a certificate, Windows shows "Unknown publisher". Buy a Windows code-signing
certificate and add two repository secrets: `WINDOWS_CERT_BASE64` (the .pfx file,
base64-encoded) and `WINDOWS_CERT_PASSWORD`.

### Private repository

electron-updater reads releases without signing in, so automatic updates need the releases
somewhere public. While this repository is private, publish releases to a separate public
"releases" repository or a download server instead (change `publish` in
`apps/desktop/electron-builder.yml`).

## Building the installer on a Windows PC

```bash
npm install
npm run build -w @ceo/shared
npm run dist:win -w @ceo/desktop
```

The installer appears in `apps/desktop/release/`.

## Third-party notices

After changing dependencies, run `node scripts/notices.mjs` and commit the updated
`THIRD_PARTY_NOTICES.md`. The installer ships it with `LICENSE`.

## Licences

Only for customers hosting it themselves. The key pair can be the same one used for the HR
system. Once:

```bash
npm run licence:keys -w @ceo/server
```

This writes `licence-private.pem` (keep it secret, back it up, never commit it) and prints
the public key for `LICENCE_PUBLIC_KEY`. For each customer:

```bash
npm run licence:sign -w @ceo/server -- --customer "Acme Ltd" --edition business \
  --modules approvals,people,predicto --max 25 --expires 2027-12-31 --out licence.json
```

`--max` is the number of logins.
