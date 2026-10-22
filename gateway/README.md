# gateway: the sign in, on a server

AskCharts has no login of its own, and it runs indicator code on the machine it's on. On your own computer
that's fine: it only listens to that computer. On a server the internet can reach, this gateway goes in
front of it, and nothing gets through until you're signed in with a passkey (Touch ID, Face ID, Windows
Hello or your phone).

The Docker install runs it for you (`run.mjs` starts it when `ASKCHARTS_GATEWAY=1`). The
[server guide](../docs/server.md) walks through it.

## How sign in works

- **One account,** the email in `ASKCHARTS_EMAIL`. There's no sign up.
- **Sign in:** type the email, press Continue with passkey, confirm with your device.
- **Your first passkey, or a new device:** a one-time link you make on the server:
  `docker compose exec askcharts node gateway/link.mjs`. It works once and expires in 15 minutes, and
  anyone who opens it in that time can add a passkey, so open it only on your own device. The sign-in
  page has no way to ask for one and the gateway sends no email, so a stranger can't trigger anything.
  Passkeys that sync (iCloud Keychain, Google Password Manager) reach your other devices without a link.
- **Sessions** last 7 days, in a cookie the app never sees. Sign out from the AskCharts logo.

## What it enforces

- Only the sign-in page and its own routes answer without a session.
- Every write must come from your own address (`ASKCHARTS_ORIGIN`).
- Saving or deleting a JavaScript indicator, or importing a signal, asks for your passkey again.
- Rate limits on sign in, so guessing is slow.
- The app's pages get a strict content security policy: scripts only from your own address.

## Settings

`run.mjs` sets these from the Docker settings: `ORIGIN`, `RP_ID` (its host name), `ALLOWED_EMAIL`,
`UPSTREAM` (the app), `DATA_DIR`, `HOST` and `PORT` (3778), and `TRUST_PROXY` from
`ASKCHARTS_TRUST_PROXY`. That one tells the gateway what's in front of it, so the rate limits count each
visitor: `cloudflare` for a Cloudflare tunnel, `forwarded` for Caddy, nginx and the like, empty when
nothing is in front. Anyone can send the headers these read, so set it only to what you really use. A
value it doesn't know stops the gateway from starting.

## Tests

`npm test` here: 32 tests against a stand-in app. They need this folder's two packages (`npm ci`).
