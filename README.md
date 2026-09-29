# Encyclopedia Punkorum — Backend

Minimal Express API for the [Encyclopedia Punkorum](../encylopedia-punkorum-ironhack) React front end.

Replaces json-server, which could not do two things this project needs:

- **validation** — nothing stopped a band from being saved without a name;
- **a MusicBrainz proxy** — MusicBrainz requires a `User-Agent` header identifying the
  application, and a browser is not allowed to set that header (it is a *forbidden header
  name*). A server can.

## Run it

```bash
npm install
npm start        # http://localhost:3001
npm run dev      # same, restarts on file changes
npm run test:run # Vitest + supertest
npm run typecheck # tsc: checks types, emits nothing
```

Then start the front end (`npm run dev` in the other repo, port 5173).

## TypeScript

Node (>= 22.18) runs the `.ts` files directly by stripping the types: there is no build
step and no `dist/` folder. `tsc` only checks the types (`npm run typecheck`). Because
Node strips types without compiling, only erasable syntax is allowed (no `enum`, no
`namespace`), and imports keep their `.ts` extension.

## Files

| File | Role |
|---|---|
| `app.ts` | The whole API. `createApp()` builds it but never starts it |
| `server.ts` | Starts it, and shuts down cleanly on `SIGTERM`/`SIGINT` |
| `app.test.ts` | 25 tests (Vitest + supertest) against a throwaway database |

They are split only so the tests can import the app without opening a port.

## Routes

| Method | Path | What it does |
|---|---|---|
| `GET` | `/bands` | All local bands |
| `GET` | `/bands/:id` | One band, `404` if unknown |
| `POST` | `/bands` | Creates a band. **The server generates the id.** `400` if the name is missing |
| `PUT` | `/bands/:id` | Replaces a band, `404` if unknown, `400` if the name is missing |
| `DELETE` | `/bands/:id` | Deletes a band, `204` on success, `404` if unknown |
| `GET` | `/api/mb/*` | Proxies MusicBrainz, adding the `User-Agent` header |

Example: the front calls `/api/mb/artist?query=...`, which the server forwards to
`https://musicbrainz.org/ws/2/artist?query=...`.

A malformed JSON body returns `400`, not `500` — a bad request is the client's mistake,
not a server failure.

## Configuration

| Variable | Default |
|---|---|
| `PORT` | `3001` |
| `FRONTEND_URL` | `http://localhost:5173` — the only origin allowed by CORS |
| `MB_USER_AGENT` | `EncyclopediaPunkorum/1.0 (student project)` |

⚠️ Set `FRONTEND_URL` to the deployed front-end URL when deploying, or the browser will
block every request.

## Hardening

| What | Why |
|---|---|
| CORS limited to `FRONTEND_URL` | `cors()` with no options lets **any** website read this API |
| Rate limit: 100 requests/minute per IP | A script cannot hammer the server |
| Body limit: 100 kB (`413` above) | A band is small; huge payloads are refused |
| Writes are queued | Two simultaneous creations used to erase each other |
| Atomic writes (`.tmp` + `rename`) | A crash mid-write cannot truncate `db.json` |
| MusicBrainz responses cached 5 min | Stays under their rate limit; `X-Cache: HIT/MISS/STALE` |
| Stale cache served on `503` | A rate-limited answer beats an empty page |
| Unknown routes return JSON `404` | Not an HTML error page |

**No personal data is committed to this repository, on purpose.** MusicBrainz asks for a
way to contact the application owner; set `MB_USER_AGENT` in the host's environment
variables to provide one. The code never hardcodes an email or a name.

## Storage

`db.json`, read and written on every request — the same approach json-server used.

Two known limits:

- **not safe for concurrent writes** — two simultaneous requests can overwrite each other;
- **not persistent on an ephemeral filesystem** — on hosts like Render's free tier the
  file is reset on every restart, so bands added online would disappear.

Both are accepted for now and will be fixed by moving to a hosted database (Postgres)
before the final deployment — see "Bugs & idées" in `PLANNING.md` in the front-end repo.
