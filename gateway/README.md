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
- **Your first passkey, or a new device:** a one-time link. On the sign-in page, "New device? Email me a
  link" sends it (or, with `MAIL_MODE=log`, writes it to the log). Or make one on the server:
  `docker compose exec askcharts node gateway/link.mjs`. A link works once and expires in 15 minutes.
- **Sessions** last 7 days, in a cookie the app never sees. Sign out from the AskCharts logo.

## What it enforces

- Only the sign-in page and its own routes answer without a session.
- Every write must come from your own address (`ASKCHARTS_ORIGIN`).
- Saving or deleting a JavaScript indicator, or importing a signal, asks for your passkey again.
- Rate limits on sign in and on links, so guessing and mail spam are slow.
- The app's pages get a strict content security policy: scripts only from your own address.

## Settings

`run.mjs` sets these from the Docker settings: `ORIGIN`, `RP_ID` (its host name), `ALLOWED_EMAIL`,
`UPSTREAM` (the app), `DATA_DIR`, `HOST` and `PORT` (3778). To email links, set `MAIL_MODE=resend`,
`RESEND_API_KEY` (a sending-only key from resend.com) and `MAIL_FROM` (like
`AskCharts <sign-in@your-domain>`).

## Tests

`npm test` here: 30 tests against a stand-in app. They need this folder's two packages (`npm ci`).
