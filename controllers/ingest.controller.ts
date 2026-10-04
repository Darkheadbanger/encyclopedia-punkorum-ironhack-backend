// Bringing a MusicBrainz band into the encyclopedia.
//
// Two routes, both server-side. The browser never calls MusicBrainz: it searches
// through us, imports through us, and from then on reads the band from our own
// database like any other.
//
// A factory, not plain handlers: the client is injected so the tests can answer for
// MusicBrainz without a network.

import type { Request, Response } from "express";
import Band from "../models/Band.model.ts";
import { toBandFields } from "../services/musicbrainz.ts";
import type { MusicBrainzClient } from "../services/musicbrainz.ts";

const SEARCH_LIMIT = 25;
const DUPLICATE_KEY = 11000;

export const createIngestController = (musicBrainz: MusicBrainzClient) => ({
  /** Candidates for a search, already in our shape, each saying whether we have it. */
  searchUpstream: async (req: Request, res: Response) => {
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      res.status(400).json({ error: "A search term is required." });
      return;
    }

    const artists = await musicBrainz.searchArtists(query, SEARCH_LIMIT);

    // One artist with no name must not sink the whole search.
    const candidates = artists.flatMap((artist) => {
      try {
        return [toBandFields(artist)];
      } catch {
        return [];
      }
    });

    // One query for all the candidates, not one per candidate. distinct() returns
    // the ids themselves, so there is nothing to map afterwards.
    const ids = candidates
      .map((band) => band.musicBrainzId)
      .filter((id): id is string => Boolean(id));
    const known = new Set<string>(await Band.distinct("musicBrainzId", {
      musicBrainzId: { $in: ids },
    }));

    res.json(candidates.map((band) => ({
      ...band,
      alreadyImported: known.has(band.musicBrainzId ?? ""),
    })));
  },

  /** Imports one band. The id comes from a previous search, never from a form. */
  importBand: async (req: Request, res: Response) => {
    const musicBrainzId = String((req.body ?? {}).musicBrainzId ?? "").trim();
    if (!musicBrainzId) {
      res.status(400).json({ error: "A MusicBrainz id is required." });
      return;
    }

    // Checked here for a clear 409, and enforced by the unique index underneath:
    // between this check and the insert, someone else could import the same band.
    if (await Band.exists({ musicBrainzId })) {
      res.status(409).json({ error: "This band is already in the encyclopedia." });
      return;
    }

    const artist = await musicBrainz.getArtist(musicBrainzId);

    try {
      res.status(201).json(await Band.create(toBandFields(artist)));
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        res.status(409).json({ error: "This band is already in the encyclopedia." });
        return;
      }
      throw error;
    }
  },
});
