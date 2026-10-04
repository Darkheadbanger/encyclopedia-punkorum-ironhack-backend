// Encyclopedia Punkorum — the Express application.
//
// This file builds the app but never starts it: server.ts does that, and the tests
// import it directly. That is the only reason for the split.

import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import { createBandRouter } from "./routes/band.routes.ts";
import authRoutes from "./routes/auth.routes.ts";
import { createMusicBrainzClient, MusicBrainzError } from "./services/musicbrainz.ts";
import type { BodyParserErrorType, CreateAppOptions } from "./types/index.ts";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// There used to be a /api/mb/* proxy here, so the browser could reach MusicBrainz
// through us. It is gone: the browser never calls MusicBrainz at all now. Bands
// are ingested server-side (services/musicbrainz.ts) and read back from MongoDB,
// which is why this file no longer knows that MusicBrainz exists — beyond passing
// fetch to the client the ingestion routes use.

export function createApp({ fetchImpl, retryDelayMs }: CreateAppOptions = {}) {
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

  app.use("/bands", createBandRouter(createMusicBrainzClient({ fetchImpl, retryDelayMs })));
  app.use("/auth", authRoutes);

  // --- Centralised error handling ------------------------------------------
  // No route builds a technical error response itself: they call next(error) and
  // EVERYTHING ends up here. One single place to read to know what the API returns
  // when things go wrong.

  app.use((req, res) => {
    res.status(404).json({ error: "Unknown endpoint." });
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    // MusicBrainz refused or could not be reached. Not our fault, so not a 500:
    // 404 when it does not know the band, 502 when it is unreachable.
    if (error instanceof MusicBrainzError) {
      return res.status(error.status).json({ error: error.message });
    }

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
