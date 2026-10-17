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
import { comparableName, toBandFields } from "../services/musicbrainz.ts";
import type { MusicBrainzClient } from "../services/musicbrainz.ts";

const SEARCH_LIMIT = 25;
const DUPLICATE_KEY = 11000;

/** Every band we hold, by comparable name.
 *
 *  The unique index on musicBrainzId cannot catch a band that was typed by hand or
 *  seeded from db.json: it has no MusicBrainz id at all. Importing Crass a second
 *  time therefore used to add a second Crass. This is the same comparison the
 *  ingestion script makes, so both doors apply one rule.
 *
 *  One query for the whole collection, compared in memory, because comparableName()
 *  strips accents, articles and typographic apostrophes — which Mongo cannot do in
 *  a query. Fine at this size; past a few thousand bands the normalised name would
 *  have to be stored and indexed. */
const existingNames = async () => {
  const names = await Band.distinct("name");
  return new Set((names as string[]).map(comparableName));
};

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

    const [knownIds, knownNames] = await Promise.all([
      Band.distinct("musicBrainzId", { musicBrainzId: { $in: ids } }),
      existingNames(),
    ]);
    const known = new Set<string>(knownIds);

    res.json(candidates.map((band) => ({
      ...band,
      // By name too, or a band we already hold under no MusicBrainz id would be
      // offered for import, and importing it would duplicate it.
      alreadyImported: known.has(band.musicBrainzId ?? "")
        || knownNames.has(comparableName(band.name)),
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
    const fields = toBandFields(artist);

    // The name is only known once MusicBrainz has answered, so this check comes
    // after the call — and it is the one that stops a second Crass.
    if ((await existingNames()).has(comparableName(fields.name))) {
      res.status(409).json({ error: "This band is already in the encyclopedia." });
      return;
    }

    // Once, here, instead of in every visitor's browser: the Cover Art Archive
    // address redirects twice before the file arrives, and the band page was
    // showing its placeholder for three seconds because of it.
    fields.image = await musicBrainz.resolveArtwork(fields.image);

    try {
      res.status(201).json(await Band.create(fields));
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        res.status(409).json({ error: "This band is already in the encyclopedia." });
        return;
      }
      throw error;
    }
  },
});
