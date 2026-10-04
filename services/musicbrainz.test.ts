// The MusicBrainz → Band translation.
//
// This is the only place where MusicBrainz vocabulary exists. Everything the rest
// of the app sees is already a Band. The mapper is a pure function, so it is tested
// without a network and without a database — but the last test does save the result,
// because a mapping the schema rejects is a mapping that breaks the ingestion.

import { describe, it, expect } from "vitest";
import Band from "../models/Band.model.ts";
import { comparableName, looksPunk, pickBestMatch, toBandFields } from "./musicbrainz.ts";
import type { MusicBrainzArtist } from "./musicbrainz.ts";

const CRO_MAGS_ID = "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae";

const artist = (overrides: Partial<MusicBrainzArtist> = {}): MusicBrainzArtist => ({
  id: CRO_MAGS_ID,
  name: "Cro-Mags",
  country: "US",
  type: "Group",
  disambiguation: "New York hardcore band",
  tags: [
    { name: "hardcore punk", count: 5 },
    { name: "crossover thrash", count: 3 },
    { name: "rock", count: 9 },
  ],
  "life-span": { begin: "1981", end: null, ended: false },
  "begin-area": { name: "New York" },
  ...overrides,
});

describe("toBandFields — identity and provenance", () => {
  it("keeps the name and records where the band came from", () => {
    const band = toBandFields(artist());

    expect(band.name).toBe("Cro-Mags");
    expect(band.source).toBe("musicbrainz");
    expect(band.musicBrainzId).toBe(CRO_MAGS_ID);
  });

  it("carries the disambiguation over, which is how homonyms stay apart", () => {
    expect(toBandFields(artist()).disambiguation).toBe("New York hardcore band");
  });

  it("defaults the type to Group", () => {
    expect(toBandFields(artist({ type: undefined })).type).toBe("Group");
  });
});

describe("toBandFields — place", () => {
  it("uses the country code and the begin-area as the location", () => {
    const band = toBandFields(artist());

    expect(band.country).toBe("US");
    expect(band.location).toBe("New York");
  });

  it("falls back to empty strings rather than undefined", () => {
    const band = toBandFields(artist({ country: undefined, "begin-area": undefined }));

    expect(band.country).toBe("");
    expect(band.location).toBe("");
  });
});

describe("toBandFields — dates", () => {
  // MusicBrainz dates come as "1981", "1981-05" or "1981-05-12". The schema only
  // accepts a four-digit year, so anything else has to be cut down.
  it.each([
    ["1981", "1981"],
    ["1981-05", "1981"],
    ["1981-05-12", "1981"],
  ])("reduces %s to the year %s", (begin, expected) => {
    expect(toBandFields(artist({ "life-span": { begin } })).formed).toBe(expected);
  });

  it("reads an active band as Active with no disbanding year", () => {
    const band = toBandFields(artist());

    expect(band.status).toBe("Active");
    expect(band.disbanded).toBeNull();
  });

  it("reads an ended band as Split-up with its last year", () => {
    const band = toBandFields(artist({ "life-span": { begin: "1981", end: "1992-07", ended: true } }));

    expect(band.status).toBe("Split-up");
    expect(band.disbanded).toBe("1992");
  });

  // A band with no dates at all is common on MusicBrainz. It must not block the
  // ingestion, and it must not claim to be active either.
  it("leaves the dates empty and the status unknown when MusicBrainz has none", () => {
    const band = toBandFields(artist({ "life-span": undefined }));

    expect(band.formed).toBe("");
    expect(band.disbanded).toBeNull();
    expect(band.status).toBe("Unknown");
  });

  it("drops a year the schema would refuse instead of failing", () => {
    expect(toBandFields(artist({ "life-span": { begin: "19??" } })).formed).toBe("");
    expect(toBandFields(artist({ "life-span": { begin: "1066" } })).formed).toBe("");
  });
});

describe("toBandFields — genres", () => {
  // MusicBrainz tags are free text: "rock", "seen live", "favourites". Only the
  // punk-related ones are genres for this encyclopedia.
  it("keeps the punk-related tags and drops the rest", () => {
    expect(toBandFields(artist()).genre).toEqual(["hardcore punk", "crossover thrash"]);
  });

  it("orders them by how many people agreed on the tag", () => {
    const band = toBandFields(artist({
      tags: [
        { name: "crust punk", count: 1 },
        { name: "d-beat", count: 7 },
        { name: "grindcore", count: 4 },
      ],
    }));

    expect(band.genre).toEqual(["d-beat", "grindcore", "crust punk"]);
  });

  it("returns an empty list rather than nothing when no tag is punk", () => {
    expect(toBandFields(artist({ tags: [{ name: "jazz", count: 2 }] })).genre).toEqual([]);
    expect(toBandFields(artist({ tags: undefined })).genre).toEqual([]);
  });

  it("never lists the same genre twice", () => {
    const band = toBandFields(artist({
      tags: [{ name: "punk", count: 2 }, { name: "Punk", count: 1 }],
    }));

    expect(band.genre).toEqual(["punk"]);
  });
});

describe("toBandFields — discography", () => {
  const withReleases = () => artist({
    "release-groups": [
      { id: "r1", title: "The Age of Quarrel", "primary-type": "Album", "first-release-date": "1986-11" },
      { id: "r2", title: "Live at CBGB", "primary-type": "Album", "secondary-types": ["Live"] },
      { id: "r3", title: "Demo 1984", "primary-type": "Album", "secondary-types": ["Demo"] },
      { id: "r4", title: "We Gotta Know", "primary-type": "Single", "first-release-date": "1986" },
    ],
  });

  it("translates MusicBrainz release types into the encyclopedia's own", () => {
    const albums = toBandFields(withReleases()).albums;

    expect(albums).toEqual([
      { title: "The Age of Quarrel", year: "1986", type: "Full-length" },
      { title: "Live at CBGB", year: "", type: "Live album" },
      { title: "Demo 1984", year: "", type: "Demo" },
      { title: "We Gotta Know", year: "1986", type: "Single" },
    ]);
  });

  it("prefers the secondary type, which is the more precise one", () => {
    const album = toBandFields(artist({
      "release-groups": [{ id: "r1", title: "Best Of", "primary-type": "Album", "secondary-types": ["Compilation"] }],
    })).albums[0];

    expect(album.type).toBe("Compilation");
  });

  it("keeps a type it does not know rather than inventing one", () => {
    const album = toBandFields(artist({
      "release-groups": [{ id: "r1", title: "Interview", "primary-type": "Other", "secondary-types": ["Interview"] }],
    })).albums[0];

    expect(album.type).toBe("Interview");
  });

  it("returns an empty discography when MusicBrainz sends none", () => {
    expect(toBandFields(artist()).albums).toEqual([]);
  });
});

// MusicBrainz holds no photographs. Its sister project, the Cover Art Archive,
// serves sleeve art by release-group id — so a band gets the cover of its best
// known record. No extra request at ingestion time: the URL is built, and the page
// falls back to a placeholder if the archive has nothing.
describe("toBandFields — artwork", () => {
  it("points at the cover art of the band's first album", () => {
    const band = toBandFields(artist({
      "release-groups": [
        { id: "rg-1", title: "The Age of Quarrel", "primary-type": "Album", "first-release-date": "1986" },
      ],
    }));

    expect(band.image).toBe("https://coverartarchive.org/release-group/rg-1/front-500");
  });

  // A compilation sleeve is a poor portrait of a band: prefer a real album.
  it("prefers the earliest album over a later compilation", () => {
    const band = toBandFields(artist({
      "release-groups": [
        { id: "rg-live", title: "Live", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "1989" },
        { id: "rg-best", title: "Best Of", "primary-type": "Album", "secondary-types": ["Compilation"], "first-release-date": "2000" },
        { id: "rg-first", title: "The Age of Quarrel", "primary-type": "Album", "first-release-date": "1986" },
      ],
    }));

    expect(band.image).toContain("rg-first");
  });

  it("falls back to any release when the band has no studio album", () => {
    const band = toBandFields(artist({
      "release-groups": [{ id: "rg-demo", title: "Demo", "primary-type": "Album", "secondary-types": ["Demo"] }],
    }));

    expect(band.image).toContain("rg-demo");
  });

  it("leaves the image empty when there is no release at all", () => {
    expect(toBandFields(artist()).image).toBeNull();
  });
});

describe("toBandFields — members", () => {
  const withRelations = () => artist({
    relations: [
      {
        type: "member of band",
        begin: "1981",
        end: "1992",
        attributes: ["lead vocals"],
        artist: { id: "a1", name: "John Joseph" },
      },
      {
        type: "member of band",
        begin: "1981",
        end: null,
        attributes: ["bass"],
        artist: { id: "a2", name: "Harley Flanagan" },
      },
      { type: "producer", artist: { id: "a3", name: "Not A Member" } },
    ],
  });

  it("keeps the band members and ignores the other relations", () => {
    const members = toBandFields(withRelations()).members;

    expect(members).toHaveLength(2);
    expect(members.map((member) => member.name)).toEqual(["John Joseph", "Harley Flanagan"]);
  });

  it("turns the attributes into an instrument and the dates into a period", () => {
    const [first, second] = toBandFields(withRelations()).members;

    expect(first).toEqual({ name: "John Joseph", instrument: "lead vocals", period: "1981-1992" });
    // Still in the band: the period stays open instead of inventing an end
    expect(second.period).toBe("1981-");
  });

  it("skips a relation with no artist name, which would save an empty member", () => {
    const members = toBandFields(artist({
      relations: [{ type: "member of band", artist: undefined }],
    })).members;

    expect(members).toEqual([]);
  });

  it("returns an empty list when MusicBrainz sends no relation", () => {
    expect(toBandFields(artist()).members).toEqual([]);
  });
});

// Searching MusicBrainz for tag:"punk" returns U2, Depeche Mode and The Cure:
// one person tagging a band "punk" is enough to match. A punk encyclopedia cannot
// take that at face value, so the tag has to be one of the band's MAIN ones.
describe("looksPunk", () => {
  it("accepts a band whose main tag is punk", () => {
    expect(looksPunk(artist())).toBe(true);
  });

  it("rejects a rock band carrying one stray punk tag", () => {
    // U2, as MusicBrainz actually describes it
    const u2 = artist({
      name: "U2",
      tags: [
        { name: "rock", count: 12 },
        { name: "pop rock", count: 8 },
        { name: "alternative rock", count: 7 },
        { name: "post-punk", count: 1 },
      ],
    });

    expect(looksPunk(u2)).toBe(false);
  });

  it("accepts a band where punk comes second behind a broader tag", () => {
    const band = artist({
      tags: [{ name: "rock", count: 9 }, { name: "hardcore punk", count: 8 }],
    });

    expect(looksPunk(band)).toBe(true);
  });

  it("rejects a band with no punk tag at all", () => {
    expect(looksPunk(artist({ tags: [{ name: "jazz", count: 4 }] }))).toBe(false);
  });

  // The Rules page is the specification: "the music must BE punk or hardcore, not
  // be LABELLED punk". post-punk and new wave are punk-adjacent, not punk — and
  // they are what drags U2, The Smiths and New Order into a tag search.
  it.each([
    "post-punk",          // The Cure, New Order
    "post-punk revival",  // Franz Ferdinand, Bloc Party
    "dance-punk",
    "punk blues",         // Nick Cave
    "new wave",
    "no wave",
    "gothic rock",
    "pub rock",
    "ska",                // Madness: 2 Tone ska is not ska punk
  ])("rejects a band whose only punk-ish tag is %s", (tag) => {
    expect(looksPunk(artist({ tags: [{ name: tag, count: 9 }] }))).toBe(false);
  });

  // The exclusion is on the exact tag, so the punk fusions still qualify.
  it.each(["ska punk", "skacore", "folk punk", "proto-punk", "art punk"])(
    "still accepts %s",
    (tag) => {
      expect(looksPunk(artist({ tags: [{ name: tag, count: 9 }] }))).toBe(true);
    },
  );

  it("accepts a punk band that also carries post-punk", () => {
    // The Clash: punk first, post-punk later
    const band = artist({
      tags: [{ name: "punk rock", count: 10 }, { name: "post-punk", count: 4 }],
    });

    expect(looksPunk(band)).toBe(true);
  });

  // Rejected by the ingestion, not by the encyclopedia: Joy Division and PiL are
  // in db.json because a human put them there on purpose.
  it("leaves a purely post-punk band to be added by hand", () => {
    const joyDivision = artist({
      name: "Joy Division",
      tags: [{ name: "post-punk", count: 12 }, { name: "gothic rock", count: 5 }],
    });

    expect(looksPunk(joyDivision)).toBe(false);
  });

  // No tags means MusicBrainz knows nothing, not that the band is punk.
  it("rejects a band with no tags", () => {
    expect(looksPunk(artist({ tags: undefined }))).toBe(false);
    expect(looksPunk(artist({ tags: [] }))).toBe(false);
  });

  it("accepts an untagged count: an unvoted punk tag still counts", () => {
    expect(looksPunk(artist({ tags: [{ name: "crust punk" }] }))).toBe(true);
  });
});

// db.json has "The Misfits", MusicBrainz has "Misfits". Matching the raw strings
// imported the same band twice.
describe("comparableName", () => {
  it("treats a name with and without its article as the same band", () => {
    expect(comparableName("Misfits")).toBe(comparableName("The Misfits"));
    expect(comparableName("the clash")).toBe(comparableName("The Clash"));
  });

  it("ignores case and surrounding spaces", () => {
    expect(comparableName("  RAMONES ")).toBe(comparableName("Ramones"));
  });

  // "The" inside a name is part of it: these are two different bands.
  it("only strips a leading article", () => {
    expect(comparableName("They Might Be Giants")).not.toBe(comparableName("Might Be Giants"));
    expect(comparableName("Death")).not.toBe(comparableName("The Death Set"));
  });
});

describe("toBandFields — the result is a valid Band", () => {
  // The mapper is useless if the schema refuses what it produces: the ingestion
  // would fail on the real data and only there.
  it("saves without the schema complaining", async () => {
    const band = await new Band(toBandFields(artist())).save();

    expect(band.id).toMatch(/^[0-9a-f]{24}$/);
    await Band.deleteMany({});
  });

  it("saves even when MusicBrainz sends almost nothing", async () => {
    const bare = { id: "11111111-1111-1111-1111-111111111111", name: "Unknown Band" };
    const band = await new Band(toBandFields(bare)).save();

    expect(band.name).toBe("Unknown Band");
    expect(band.source).toBe("musicbrainz");
    await Band.deleteMany({});
  });

  it("refuses to map an artist with no name: that is bad data, not a band", () => {
    expect(() => toBandFields({ id: CRO_MAGS_ID, name: "  " })).toThrow(/name/i);
  });
});

// Backfilling artwork for the hand-written bands means matching "The Misfits" in
// our database against what MusicBrainz returns for that search. A wrong match
// puts the wrong sleeve on a band, so the rule is strict: the names must be equal.
describe("pickBestMatch", () => {
  const found = (...names: string[]) =>
    names.map((name, index) => ({ id: `mb-${index}`, name }));

  it("takes the artist whose name is the same", () => {
    expect(pickBestMatch("Crass", found("Crass Ensemble", "Crass"))?.name).toBe("Crass");
  });

  it("matches across a leading article, as comparableName does", () => {
    expect(pickBestMatch("The Misfits", found("Misfits"))?.id).toBe("mb-0");
    expect(pickBestMatch("Misfits", found("The Misfits"))?.id).toBe("mb-0");
  });

  it("ignores case and spacing", () => {
    expect(pickBestMatch("  ramones ", found("Ramones"))?.id).toBe("mb-0");
  });

  // Better no picture than the sleeve of another band.
  it("returns nothing when no name is equal", () => {
    expect(pickBestMatch("Crass", found("Crass Ensemble", "Crassh"))).toBeUndefined();
  });

  it("returns nothing when MusicBrainz found nobody", () => {
    expect(pickBestMatch("Crass", [])).toBeUndefined();
  });

  it("prefers the first exact match when there are several", () => {
    expect(pickBestMatch("Death", found("Death", "Death"))?.id).toBe("mb-0");
  });
});

// Real mismatches met while backfilling artwork: MusicBrainz writes "Cap’n Jazz"
// with a typographic apostrophe, "Ratos de Porão" with a tilde, and "blink‐182"
// with a non-ASCII hyphen. Comparing raw strings missed all three.
describe("comparableName — punctuation and accents", () => {
  it("treats a typographic apostrophe as a plain one", () => {
    expect(comparableName("Cap’n Jazz")).toBe(comparableName("Cap'n Jazz"));
  });

  it("ignores accents, so Porão matches Porao", () => {
    expect(comparableName("Ratos de Porão")).toBe(comparableName("Ratos de Porao"));
    expect(comparableName("Die Ärzte")).toBe(comparableName("Die Arzte"));
  });

  it("treats every kind of dash as a hyphen", () => {
    expect(comparableName("blink‐182")).toBe(comparableName("blink-182"));
    expect(comparableName("Anti‐Flag")).toBe(comparableName("Anti-Flag"));
  });

  // Still two different bands: the normalisation must not go so far as to merge them.
  it("does not flatten genuinely different names", () => {
    expect(comparableName("Discharge")).not.toBe(comparableName("Discharger"));
    expect(comparableName("Doom")).not.toBe(comparableName("Doomed"));
  });
});
