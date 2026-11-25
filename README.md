# Encyclopedia Punkorum — Back end

The REST API of [Encyclopedia Punkorum](https://github.com/Darkheadbanger/encylopedia-punkorum-ironhack),
a collaborative encyclopedia of punk bands. Built with **Express 5**, **MongoDB** and
**Mongoose**, in TypeScript.

**Live site:** https://encyclopediapunkorum.netlify.app (the API is hosted on Render)

## Tech stack

| Part | Tools |
|---|---|
| Server | Node.js (>= 22.18), Express 5, TypeScript |
| Database | MongoDB Atlas, Mongoose 9 |
| Authentication | JSON Web Token (jsonwebtoken), bcryptjs |
| Security | cors, express-rate-limit |
| Tests | Vitest, Supertest, mongodb-memory-server |
| External data | MusicBrainz API (server side only) |
| Hosting | Render |

## Run it locally

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:3001, restarts on file changes
```

Then start the front end (`npm run dev` in the other repository, port 5173).

| Script | What it does |
|---|---|
| `npm start` | Starts the API |
| `npm run dev` | Same, restarts on file changes |
| `npm run test:run` | Runs all the tests once |
| `npm test` | Tests in watch mode |
| `npm run typecheck` | TypeScript check, emits nothing |
| `npm run seed` | **Empties** the bands collection, then loads `db.json` into it |
| `npm run ingest` | Adds bands from MusicBrainz (only the missing ones, never overwrites) |
| `npm run backfill-art` | Finds artwork for bands that have none |

Node runs the `.ts` files directly by stripping the types: there is no build step and no
`dist/` folder. That is why imports keep their `.ts` extension.

## Configuration

Copy `.env.example` to `.env`. The `.env` file is **never committed** (it is in `.gitignore`).

| Variable | Role |
|---|---|
| `MONGODB_URI` | MongoDB connection string (Atlas in production) |
| `TOKEN_SECRET` | Secret used to sign the JWTs: a long random string |
| `FRONTEND_URL` | The only website allowed to call the API (CORS). Default `http://localhost:5173` |
| `PORT` | Server port. Default `3001`; Render provides it |
| `MB_USER_AGENT` | How the app identifies itself to MusicBrainz |

The server **refuses to start** if `TOKEN_SECRET` is missing or MongoDB does not answer:
better a server that fails loudly at startup than one that answers 500 to every request.

## Data model

Three collections. Diagram: [dbdiagram.io](https://dbdiagram.io/d/Encyclopedia-Punkorum-ERD-6b07478d65147998020ca9f2)

| Model | Main fields | Notes |
|---|---|---|
| **User** | `email` (unique), `password`, `username` | The password is hashed with bcrypt in a `pre("save")` hook, and never sent back in a response |
| **Band** | `name`, `country`, `status`, `formed`, `genre[]`, `albums[]`, `members[]`, `source`, `musicBrainzId`... | Albums and members are **embedded** sub-documents: they are never read without their band |
| **Review** | `content`, `rating` (1 to 5), `author` → User, `band` → Band | Its own collection, with two references: a review is also read on its own (latest reviews) |

Relations: a user writes many reviews, a band receives many reviews (one-to-many).
Deleting a band also deletes its reviews.

**Validation lives in the schemas** (`required`, `minlength`, `maxlength`, `match`, custom
validators for the years and the rating). No route can save an invalid document, even
one that forgot to check. All models return `id` instead of Mongo's `_id`.

## API routes

`🔒` = requires a token (`Authorization: Bearer <token>`).

### Authentication — `/auth`

| Method | Path | What it does |
|---|---|---|
| `POST` | `/auth/signup` | Creates an account. `201`, `400` if invalid or email already used |
| `POST` | `/auth/login` | Returns `{ authToken }` (valid 7 days). `401` if wrong email or password |
| `GET` | `/auth/verify` 🔒 | Returns the logged-in user, read from the database. `401` if the token is invalid or the account no longer exists |

### Bands — `/bands`

| Method | Path | What it does |
|---|---|---|
| `GET` | `/bands` | All bands, newest first |
| `GET` | `/bands/:id` | One band. `404` if unknown |
| `POST` | `/bands` 🔒 | Creates a band. `201`, `400` if invalid |
| `PUT` | `/bands/:id` 🔒 | Updates a band (validated). `404` if unknown |
| `DELETE` | `/bands/:id` 🔒 | Deletes a band and its reviews. `204` |
| `GET` | `/bands/upstream?q=` 🔒 | Searches MusicBrainz, returns candidates in our own format |
| `POST` | `/bands/import` 🔒 | Imports a band from MusicBrainz. `201`, `409` if already there |

The server owns `id`, `source`, `musicBrainzId` and the timestamps: they are removed from
the request body if a client sends them.

### Reviews — `/reviews`

| Method | Path | What it does |
|---|---|---|
| `GET` | `/reviews` | All reviews, newest first. `?band=<id>` for one band's reviews |
| `GET` | `/reviews/:id` | One review. `404` if unknown |
| `POST` | `/reviews` 🔒 | Creates a review. The author is taken from the token, never from the body |
| `PUT` | `/reviews/:id` 🔒 | Updates a review. **`403` if you are not its author** |
| `DELETE` | `/reviews/:id` 🔒 | Deletes a review. **`403` if you are not its author**. `204` |

`401` means "who are you?" (no valid token). `403` means "I know who you are, but this is
not yours".

## Error handling

Controllers do not build error responses themselves. Express 5 forwards any error thrown
in an async handler to **one error-handling middleware** at the end of `app.ts`, which
turns it into the right status:

| Error | Status |
|---|---|
| Mongoose validation error | `400` with the first validation message |
| Wrong type in the body, invalid JSON | `400` |
| Email already used (unique index) | `400` |
| Unknown id, unknown route | `404` |
| Body larger than 100 kB | `413` |
| MusicBrainz unreachable | `502` |
| Anything else | `500`, logged on the server, generic message to the client |

## Security

| What | Why |
|---|---|
| Passwords hashed with bcrypt (10 salt rounds) | A stolen database does not reveal passwords |
| JWT signed with HS256, algorithm pinned on verification | Blocks the `alg: none` and algorithm-confusion attacks |
| Token checked against the database on `/auth/verify` | A deleted account cannot stay logged in |
| Author check on review edit/delete (`403`) | Nobody can change someone else's review |
| CORS limited to `FRONTEND_URL` | Other websites cannot call the API from a visitor's browser |
| Rate limit: 100 requests per minute per IP | A script cannot hammer the server |
| Body limit: 100 kB | Huge payloads are refused |
| Secrets only in environment variables | Nothing secret is committed |
| MusicBrainz only called by the server | The browser never talks to a third-party API |

## Project structure

```
app.ts            Builds the Express app (middlewares, routes, error handler) without starting it
server.ts         Connects to MongoDB, then starts the app and shuts down cleanly
config/jwt.ts     Token algorithm, lifetime and secret
db/               MongoDB connection, strict type checking for Mongoose
models/           User, Band, Review (Mongoose schemas)
routes/           URL → controller, and which routes are protected
controllers/      What each route does (auth, bands, reviews, MusicBrainz import)
middleware/       isAuthenticated: checks the JWT
services/         MusicBrainz client (the only file that knows MusicBrainz)
types/            Shared TypeScript types
seed.ts, ingest.ts, backfill-art.ts   Scripts to fill the database
db.json           Source data for the seed script. The API never reads it
```

`app.ts` and `server.ts` are split so the tests can import the app without opening a port.

## Tests

```bash
npm run test:run
```

Around 290 tests with Vitest and Supertest. They run against an **in-memory MongoDB**
(mongodb-memory-server), so they never touch the real database, and MusicBrainz is
replaced by a fake client. They cover every route, the models' validation, the
authentication middleware, the JWT configuration and the error handler.

## Deployment

- API on **Render**. Environment variables are set in the Render dashboard. The free plan
  sleeps when unused: the first request can take up to a minute.
- Database on **MongoDB Atlas**.
- `FRONTEND_URL` is set to the Netlify address, otherwise the browser blocks every request.
- `app.set("trust proxy", 1)` so the rate limit sees each visitor's real IP behind
  Render's load balancer.

## Author

David Bouhaben — Ironhack Web Development bootcamp (MERN), 2026.
