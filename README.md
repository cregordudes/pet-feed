# Cats

A private feeding list for two people and both cats. One shared checklist. Each check is marked Husband or Wife.

The browser is the whole app. There is no account system and no reminders.

Requires Node.js 22 or newer.

## Develop

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` starts the API and the Vite dev server together. Use that one port. Vite proxies `/api` to the API, so the role cookie and the JSON routes stay on the same origin.

Leave `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` unset on your machine. The screen then shows a Husband / Wife switch so you can mark a feeding as either person. That switch exists only for local development. Do not expose it on a public host. `npm start` exits if those variables are missing.

The database file is created at `data/feed.db` the first time the server starts. The `data/` directory is gitignored.

```bash
npm test
```

## Production

```bash
npm run build
npm start
```

`npm run build` writes the static UI to `dist/` and compiles the server. `npm start` serves both the UI and the JSON API from one process.

The server listens on port **8787** unless `PORT` is set. Bind address defaults to `0.0.0.0` (`HOST` overrides it).

| Variable | Purpose |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Team host, such as `your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Application Audience (AUD) tag |
| `PORT` | Listen port. Default `8787` |
| `HOST` | Listen address. Default `0.0.0.0` |
| `DATABASE_PATH` | SQLite file. Default `data/feed.db` |

Set both Cloudflare variables, or neither. One without the other is a broken configuration and the process exits. Production (`NODE_ENV=production`, which `npm start` sets) also exits when both are empty, so the dev switch cannot be deployed by accident.

The server reads the process environment. It does not load a `.env` file.

## Cloudflare Access

Access is the only login. The app has no sign-in screen. It trusts a request only after verifying the `Cf-Access-Jwt-Assertion` JWT against the team certificate endpoint and the application audience. The `Cf-Access-Authenticated-User-Email` header is not trusted on its own.

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/), create a self-hosted Access application for the public hostname of this site. A Cloudflare Tunnel is the usual way to put the Node server behind that hostname without opening the origin to the internet. Forward `Cf-Access-Jwt-Assertion` to the app.
2. Add one Allow policy. Under Include, choose **Emails** and add exactly two addresses — the two people who share this list. Do not add a domain wildcard, “everyone”, or a second policy that lets more people in.
3. Open the application and copy the **Application Audience (AUD)** tag into `CF_ACCESS_AUD`.
4. Set `CF_ACCESS_TEAM_DOMAIN` to the team host only, for example `your-team.cloudflareaccess.com` (no path, no `https://`). The app loads signing keys from `https://<team-domain>/cdn-cgi/access/certs` and checks that the token issuer is `https://<team-domain>` and that the audience matches `CF_ACCESS_AUD`.
5. Keep the origin unreachable except through Cloudflare. Verification rejects a forged email header, and a closed origin means anonymous clients never reach the process directly.

The first time each allowed email opens the site, that person picks Husband or Wife. The role stays on the verified email. The other role remains for the other email. Settings can swap the two roles if the first pick was wrong. Once both roles are taken, any other verified email is refused.

## Persistent disk

The log is a SQLite file. An ephemeral disk deletes it on restart or redeploy.

- Default path: `data/feed.db` (the `data/` directory is created on startup).
- Or set `DATABASE_PATH` to a file on a volume that survives restarts, for example `/var/lib/cats/feed.db`.

Mount that volume before `npm start`. Back up the file if you care about the history. There is one household timezone, stored in the same database, and it is taken from the browser the first time someone opens the app. Change it later in Settings. “Today” and overdue both follow that timezone.

## Schedule

The list starts as five meals: 09:00, 13:00, 16:00, 19:00, 23:00. Three meals, after a switch, start at 08:00, 14:00, 20:00.

- **Today only** changes times for that date and no other day.
- **From now on** changes today and every future day, leaves yesterday alone, and replaces a today-only override for today.
- A check stays on the meal’s position when the clock time changes.
- Switching between 5 and 3 meals starts on a chosen date (default today). Earlier days keep the slots they had. If today already has a check on a later slot, that feeding stays visible.
