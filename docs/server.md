# AskCharts on a server

Run AskCharts on your own server (a VPS) and open it from anywhere: your laptop, your phone, a friend's
computer. It sits behind a sign in with a passkey, because the internet can reach it.

If you only use AskCharts on one computer, you don't need any of this: use the one line install in the
README.

## What you need

- A Linux server with Docker and Docker Compose. 1 GB of memory is enough; 2 GB if you turn on XRPL On
  chain. A few GB of disk, plus about 20 GB if you download Kraken's history.
- A domain you control (a subdomain like `charts.yourdomain.com` is fine). Passkeys and HTTPS need one.
- About 15 minutes.

## 1. Get AskCharts and set it up

```sh
git clone https://github.com/realgrapedrop/askcharts.git
cd askcharts
cp .env.example .env
```

Open `.env` and set two things:

- `ASKCHARTS_ORIGIN`: the address you'll open, with https, like `https://charts.yourdomain.com`
- `ASKCHARTS_EMAIL`: your email. It's the only account that can sign in.

## 2. Start it

```sh
docker compose up -d
docker compose logs -f askcharts
```

The first start builds AskCharts (a few minutes). When the log says "AskCharts is running", it's up.
Press Ctrl+C to stop watching the log; AskCharts keeps running, and starts again after a reboot.

It listens only on the server itself (port 3778). The next step puts it online.

## 3. Put it online with HTTPS

**A. A Cloudflare tunnel** (no ports to open on your server, free):

1. Your domain on Cloudflare, then Zero Trust, Networks, Tunnels: create a tunnel (Cloudflared) and copy
   its token.
2. In the tunnel, add a public hostname: your address (`charts.yourdomain.com`), service
   `http://askcharts:3778`.
3. Put the token in `.env` as `TUNNEL_TOKEN`, and set `ASKCHARTS_TRUST_PROXY=cloudflare` there too, then:

   ```sh
   docker compose --profile tunnel up -d
   ```

**B. Your own web server with HTTPS** (Caddy, nginx and the like): send your address to
`http://127.0.0.1:3778`. With Caddy that's two lines:

```
charts.yourdomain.com {
  reverse_proxy 127.0.0.1:3778
}
```

With nginx, also pass the visitor's address on with
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (Caddy does it by itself). Then set
`ASKCHARTS_TRUST_PROXY=forwarded` in `.env` and run `docker compose up -d`.

The setting tells AskCharts which header holds each visitor's address, so the sign-in limits count
visitors one by one. Use only the one that matches what you set up: anyone can send those headers, and
AskCharts believes them only because you said a tunnel or proxy writes them.

Either way, opening your address now shows the AskCharts sign in.

## 4. Your first passkey

On the server:

```sh
docker compose exec askcharts node gateway/link.mjs
```

It prints a link that works once, for 15 minutes. Open it on the device you want to use (your phone or
laptop), press Create passkey, and confirm with Face ID, Touch ID, Windows Hello or your phone. You're in.

Another device later: run the same command again. Or set up email (below) and use "New device? Email me
a link" on the sign-in page.

## 5. Add your keys

In AskCharts: Settings (the gear), AskCharts AI. Pick the provider, paste your key, Test, pick a model, Ok.
Optional: Settings, Data keys, for an Alpaca or Polygon (Massive) key (live US stock
prices). Keys are kept on your server, in the data volume, and each is only sent to its own provider. Change
or remove them in the same places whenever you need to.

Your AI and data keys never go in the folder you cloned, so `git pull` can't touch them. The server's own
secrets, the email key and the tunnel token if you use them, are in `.env`: git ignores it, and it stays
readable only by you if you run `chmod 600 .env`. Don't share or commit it.

## Everyday

- **Update:** `git pull && docker compose up -d --build`. Your data stays.
- **Watch it:** `docker compose logs -f askcharts`
- **Stop it:** `docker compose down` (your data stays). Start again with `docker compose up -d`.
- **Back it up:** everything you make is in the `askcharts-data` volume:

  ```sh
  docker run --rm -v askcharts_askcharts-data:/data -v "$PWD":/backup busybox tar czf /backup/askcharts-data.tgz -C /data .
  ```

  (The volume's name starts with your folder's name: `askcharts_` if you cloned into `askcharts`.)
- **Sign out:** from the AskCharts logo, on each device. A session ends by itself after 7 days.

## Email for sign-in links (optional)

By default, links go to the log (`MAIL_MODE=log`). To have "New device? Email me a link" send an email,
make a free account at resend.com, verify your domain, create a sending-only API key, and set in `.env`:

```
MAIL_MODE=resend
RESEND_API_KEY=re_...
MAIL_FROM=AskCharts <sign-in@yourdomain.com>
```

Then `docker compose up -d`.

## Keep it safe

- Leave the port on `127.0.0.1` in `compose.yaml`. Docker's published ports skip your firewall, so
  publishing it on every address would put AskCharts online without HTTPS.
- AskCharts runs indicator code on the server. That's why everything is behind the sign in, and why saving
  a JavaScript indicator asks for your passkey again.
- One account, no sign up. Passkeys can't be phished or guessed.

## Let your AI set it up

If you use an AI assistant that can run commands on your server (Claude Code, for example), these prompts
walk it through. Read what it runs before you let it: an AI with a shell can change anything on the server.

1. > Install Docker Engine and the Docker Compose plugin on this server, following Docker's official
   > instructions for this Linux version. Then check that `docker compose version` works for my user.

2. > Clone https://github.com/realgrapedrop/askcharts into ~/askcharts. Copy .env.example to .env and set
   > ASKCHARTS_ORIGIN to https://charts.yourdomain.com and ASKCHARTS_EMAIL to you@yourdomain.com. Run
   > `docker compose up -d`, wait for "AskCharts is running" in `docker compose logs askcharts`, and show me
   > the last 20 lines of the log.

3. > Help me put AskCharts online through a Cloudflare tunnel. Tell me exactly what to click in
   > Cloudflare to create the tunnel with a public hostname charts.yourdomain.com pointing at
   > http://askcharts:3778. When I give you the token, put it in ~/askcharts/.env as TUNNEL_TOKEN (don't
   > print it back) and run `docker compose --profile tunnel up -d` in ~/askcharts.

4. > In ~/askcharts, run `docker compose exec askcharts node gateway/link.mjs` and give me the link.

5. > Show me how to back up the AskCharts data volume to a file, and how I'd restore it on a new server.
