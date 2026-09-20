// Encyclopedia Punkorum — the Express application.
//
// This file builds the app but never starts it: server.js starts it for real, and the
// tests import it directly. That is the only reason the two are separate files.

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const DEFAULT_DB_FILE = new URL("./db.json", import.meta.url);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2";

// MusicBrainz asks for a way to contact the app owner. We keep NO personal data in the
// code: set MB_USER_AGENT in the environment to add a contact.
const USER_AGENT = process.env.MB_USER_AGENT
  || "EncyclopediaPunkorum/1.0 (student project)";

// MusicBrainz allows about one request per second and answers 503 above that.
// Caching the answers for a few minutes keeps us well under the limit — the punk bands
// of the 1970s do not change very often.
const CACHE_TTL_MS = 5 * 60 * 1000;

export function createApp({ dbFile = DEFAULT_DB_FILE, fetchImpl = fetch } = {}) {
  const app = express();

  // Only our own front end may call this API. With cors() and no options, ANY website
  // could read it from a visitor's browser.
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json({ limit: "100kb" })); // a band is small; refuse huge payloads

  // A crude safety net against a script hammering the API.
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
  }));

  // --- Data access ---------------------------------------------------------
  // The "database" is a JSON file.

  const readBands = async () => {
    const content = await readFile(dbFile, "utf8");
    return JSON.parse(content).bands;
  };

  const saveBands = async (bands) => {
    // Write to a temporary file first, then rename: a crash mid-write cannot leave
    // db.json truncated. rename() is atomic on the same filesystem.
    const temporaryFile = new URL(`${dbFile.pathname.split("/").pop()}.tmp`, dbFile);
    await writeFile(temporaryFile, JSON.stringify({ bands }, null, 2));
    await rename(temporaryFile, dbFile);
  };

  // Every change goes through here, one at a time.
  //
  // Queueing only the write is NOT enough: two requests arriving together would both
  // read the same old file, each add its own band to that stale list, and the second
  // write would erase the first band. So the whole read-modify-write runs inside the
  // queue. (A real database does this for us with a transaction.)
  let queue = Promise.resolve();
  const updateBands = (change) => {
    const result = queue.then(async () => {
      const bands = await readBands();
      const outcome = await change(bands);
      if (outcome.save !== false) await saveBands(outcome.bands);
      return outcome;
    });
    // Keep the queue alive even if this change failed, so one error does not block
    // every later request.
    queue = result.catch(() => {});
    return result;
  };

  // --- Validation ----------------------------------------------------------
  // This is what json-server was missing. Kept as one readable function on purpose:
  // a validation library would be one more thing to explain for very little gain.

  const MAX_NAME = 200;
  const MAX_TEXT = 500;
  const MAX_LIST = 100;
  const MAX_DESCRIPTION = 20000; // the band history, several paragraphs

  const validateBand = (band) => {
    if (!band || typeof band !== "object" || Array.isArray(band)) {
      return "A band must be an object.";
    }
    if (typeof band.name !== "string" || !band.name.trim()) {
      return "A band needs a name.";
    }
    if (band.name.length > MAX_NAME) {
      return `The name must be under ${MAX_NAME} characters.`;
    }
    for (const field of ["country", "location", "status", "disambiguation", "themes", "label"]) {
      if (band[field] != null && typeof band[field] !== "string") {
        return `"${field}" must be text.`;
      }
      if (typeof band[field] === "string" && band[field].length > MAX_TEXT) {
        return `"${field}" must be under ${MAX_TEXT} characters.`;
      }
    }
    // The band history is a long text, so it gets its own, larger limit.
    if (band.description != null && typeof band.description !== "string") {
      return `"description" must be text.`;
    }
    if (typeof band.description === "string" && band.description.length > MAX_DESCRIPTION) {
      return `"description" must be under ${MAX_DESCRIPTION} characters.`;
    }
    for (const field of ["formed", "disbanded"]) {
      const year = band[field];
      if (year == null || year === "") continue;
      if (!/^\d{4}$/.test(String(year))) {
        return `"${field}" must be a 4-digit year.`;
      }
      if (Number(year) < 1900 || Number(year) > new Date().getFullYear() + 1) {
        return `"${field}" is not a plausible year.`;
      }
    }
    for (const field of ["genre", "albums", "members"]) {
      if (band[field] != null && !Array.isArray(band[field])) {
        return `"${field}" must be a list.`;
      }
      if (Array.isArray(band[field]) && band[field].length > MAX_LIST) {
        return `"${field}" cannot hold more than ${MAX_LIST} entries.`;
      }
    }
    return null;
  };

  // --- Routes: /bands ------------------------------------------------------

  app.get("/bands", async (req, res, next) => {
    try {
      res.json(await readBands());
    } catch (error) {
      next(error);
    }
  });

  app.get("/bands/:id", async (req, res, next) => {
    try {
      const band = (await readBands()).find((b) => b.id === req.params.id);
      if (!band) return res.status(404).json({ error: "Band not found." });
      res.json(band);
    } catch (error) {
      next(error);
    }
  });

  app.post("/bands", async (req, res, next) => {
    try {
      const error = validateBand(req.body);
      if (error) return res.status(400).json({ error });

      // The server owns the id, never the client.
      const newBand = { ...req.body, id: randomUUID() };
      await updateBands((bands) => ({ bands: [newBand, ...bands] }));
      res.status(201).json(newBand);
    } catch (error) {
      next(error);
    }
  });

  app.put("/bands/:id", async (req, res, next) => {
    try {
      const error = validateBand(req.body);
      if (error) return res.status(400).json({ error });

      // Keep the original id: the URL decides which band this is, not the body.
      const updatedBand = { ...req.body, id: req.params.id };
      const { found } = await updateBands((bands) => {
        const index = bands.findIndex((b) => b.id === req.params.id);
        if (index === -1) return { bands, save: false, found: false };
        return {
          bands: bands.map((b, i) => (i === index ? updatedBand : b)),
          found: true,
        };
      });

      if (!found) return res.status(404).json({ error: "Band not found." });
      res.json(updatedBand);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/bands/:id", async (req, res, next) => {
    try {
      const { found } = await updateBands((bands) => {
        const remaining = bands.filter((b) => b.id !== req.params.id);
        if (remaining.length === bands.length) {
          return { bands, save: false, found: false };
        }
        return { bands: remaining, found: true };
      });

      if (!found) return res.status(404).json({ error: "Band not found." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // --- Route: MusicBrainz proxy --------------------------------------------
  // A browser refuses to set the User-Agent header MusicBrainz requires
  // (it is a forbidden header name). A server does not.

  const cache = new Map(); // url -> { expiresAt, body }

  app.get("/api/mb/*path", async (req, res, next) => {
    try {
      const path = req.params.path.join("/");
      const query = new URLSearchParams(req.query).toString();
      const url = `${MUSICBRAINZ_URL}/${path}?${query}`;

      const cached = cache.get(url);
      if (cached && cached.expiresAt > Date.now()) {
        res.set("X-Cache", "HIT");
        return res.json(cached.body);
      }

      const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });

      if (!response.ok) {
        // 503 usually means we went over the rate limit. Serving a stale answer is far
        // better than showing the user nothing.
        if (cached) {
          res.set("X-Cache", "STALE");
          return res.json(cached.body);
        }
        return res.status(response.status).json({ error: "MusicBrainz request failed." });
      }

      const body = await response.json();
      cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body });
      res.set("X-Cache", "MISS");
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  // --- Error handling ------------------------------------------------------

  app.use((req, res) => {
    res.status(404).json({ error: "Unknown endpoint." });
  });

  app.use((error, req, res, next) => {
    // A body express.json() could not parse is the client's mistake, not a server crash
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "The request body is not valid JSON." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "The request body is too large." });
    }
    console.error(error);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return app;
}
