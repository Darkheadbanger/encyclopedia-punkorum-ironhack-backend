// Encyclopedia Punkorum — the Express application.
//
// This file builds the app but never starts it: server.ts does that, and the tests
// import it directly. That is the only reason for the split.

import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import bandRoutes from "./routes/band.routes.ts";
import authRoutes from "./routes/auth.routes.ts";
import type { BodyParserErrorType, CacheEntry, CacheStatus, CreateAppOptions } from "./types/index.ts";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2";

// MusicBrainz asks for a way to contact the app owner. NO personal data goes in
// the code: MB_USER_AGENT is set in the .env.
const USER_AGENT = process.env.MB_USER_AGENT
  || "EncyclopediaPunkorum/1.0 (student project)";

// MusicBrainz allows about one request per second and answers 503 beyond that.
// Keeping answers for a few minutes keeps us far from the limit — 70s punk bands
// don't change very often.
const CACHE_TTL_MS = 5 * 60 * 1000;

// The status MusicBrainz answers when we went over its rate limit.
const RATE_LIMITED = 503;
const DEFAULT_RETRY_DELAY_MS = 1000; // its limit is about one request per second

export function createApp({
  fetchImpl = fetch,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: CreateAppOptions = {}) {
  const app = express();

  // Only our frontend may call this API. With cors() and no options, ANY website
  // could read it from a visitor's browser.
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json({ limit: "100kb" })); // a band is small

  // A safeguard against a script hammering the API.
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
  }));

  app.use("/bands", bandRoutes);
  app.use("/auth", authRoutes);

  // --- Route: MusicBrainz proxy --------------------------------------------
  // A browser refuses to send the User-Agent header MusicBrainz requires (it is a
  // "forbidden header name"). A server can.

  const cache = new Map<string, CacheEntry>(); // key: the url

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // A 503 almost always means we were a fraction of a second too early, not that
  // MusicBrainz is down. Waiting once and asking again turns the most common
  // failure into something the visitor never sees. Any other status is retried:
  // asking a second time would not change a 404.
  const fetchFromMusicBrainz = async (url: string) => {
    const call = () => fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });

    const first = await call();
    if (first.status !== RATE_LIMITED) return first;

    await wait(retryDelayMs);
    return call();
  };
  const setCacheStatus = (res: Response, status: CacheStatus) => res.set("X-Cache", status);

  app.get("/api/mb/*path", async (req, res, next) => {
    try {
      const path = req.params.path.join("/");
      const query = new URLSearchParams(req.query as Record<string, string>).toString();
      const url = `${MUSICBRAINZ_URL}/${path}?${query}`;

      const cached = cache.get(url);
      if (cached && cached.expiresAt > Date.now()) {
        setCacheStatus(res, "HIT");
        return res.json(cached.body);
      }

      const response = await fetchFromMusicBrainz(url);

      if (!response.ok) {
        // A 503 usually means we went over the limit. Serving a stale answer is
        // much better than showing the user nothing.
        if (cached) {
          setCacheStatus(res, "STALE");
          return res.json(cached.body);
        }
        return res.status(response.status).json({ error: "MusicBrainz request failed." });
      }

      const body = await response.json();
      cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body });
      setCacheStatus(res, "MISS");
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  // --- Centralised error handling ------------------------------------------
  // No route builds a technical error response itself: they call next(error) and
  // EVERYTHING ends up here. One single place to read to know what the API returns
  // when things go wrong.

  app.use((req, res) => {
    res.status(404).json({ error: "Unknown endpoint." });
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    // A unique index rejected the write — an email already taken. Mongo decides
    // this atomically, which is why no code checks for it beforehand: between a
    // check and the insert, someone else could take the address.
    if ((error as { code?: number }).code === 11000) {
      return res.status(400).json({ error: "This email is already in use." });
    }

    // A document rejected by the Mongoose schema: that is a client error.
    // Return the first validation message, readable as is by the form.
    if (error instanceof mongoose.Error.ValidationError) {
      const first = Object.values(error.errors)[0];
      return res.status(400).json({ error: first.message });
    }

    // A rejected cast. Two very different cases:
    //  - on _id: the URL holds an id that is not an ObjectId (/bands/hello).
    //    That is not a crash, just a band that does not exist.
    //  - on another field: the client sent { name: 42 }. That is a 400.
    if (error instanceof mongoose.Error.CastError) {
      if (error.path === "_id") {
        return res.status(404).json({ error: "Band not found." });
      }
      return res.status(400).json({ error: `"${error.path}" has the wrong type.` });
    }

    // A body express.json() could not read: the client's fault, not the server's.
    const { type } = error as { type?: BodyParserErrorType };
    if (type === "entity.parse.failed") {
      return res.status(400).json({ error: "The request body is not valid JSON." });
    }
    if (type === "entity.too.large") {
      return res.status(413).json({ error: "The request body is too large." });
    }

    console.error(error);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return app;
}
