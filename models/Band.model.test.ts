// The Band schema, tested directly rather than through HTTP.
//
// app.test.ts checks the status codes the API answers; this file checks the rules
// themselves. A rule broken here is broken for every caller, including seed.ts,
// which never goes through a route.

import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import Band from "./Band.model.ts";

const nextYear = new Date().getFullYear() + 1;

// validate() runs the validators without writing anything, so these tests stay
// fast; the ones that need an _id save for real. (validateSync() would do the same
// but is deprecated and goes away in Mongoose 10.)
const errorsOf = async (fields: Record<string, unknown>) => {
  try {
    await new Band(fields).validate();
    return {} as mongoose.Error.ValidationError["errors"];
  } catch (error) {
    return (error as mongoose.Error.ValidationError).errors;
  }
};

afterEach(async () => {
  await Band.deleteMany({});
});

describe("Band schema — required fields", () => {
  it("refuses a band with no name", async () => {
    expect((await errorsOf({})).name?.message).toBe("A band needs a name.");
  });

  it("accepts a band that has only a name", async () => {
    expect(await errorsOf({ name: "Crass" })).toEqual({});
  });

  it("refuses a name longer than 200 characters", async () => {
    const errors = await errorsOf({ name: "a".repeat(201) });
    expect(errors.name?.message).toMatch(/shorter than 200/);
  });

  it("trims the surrounding whitespace of a name", () => {
    expect(new Band({ name: "  Discharge  " }).name).toBe("Discharge");
  });
});

describe("Band schema — years", () => {
  it.each([
    ["1066", "too early"],
    [String(nextYear + 1), "in the future"],
    ["77", "only two digits"],
    ["1977-10", "not just a year"],
  ])("refuses %s (%s)", async (formed) => {
    expect((await errorsOf({ name: "Crass", formed })).formed?.message)
      .toMatch(/is not a plausible year/);
  });

  it.each(["1900", "1977", String(nextYear)])("accepts %s", async (formed) => {
    expect((await errorsOf({ name: "Crass", formed })).formed).toBeUndefined();
  });

  it("accepts an empty year: the field is optional", async () => {
    const errors = await errorsOf({ name: "Crass", formed: "", disbanded: null });
    expect(errors.formed).toBeUndefined();
  });

  it("applies the same rule to an album year", async () => {
    const errors = await errorsOf({ name: "Crass", albums: [{ title: "Stations", year: "1066" }] });
    expect(errors["albums.0.year"]?.message).toMatch(/is not a plausible year/);
  });
});

describe("Band schema — list caps", () => {
  const manyGenres = (count: number) =>
    Array.from({ length: count }, (unused, index) => `genre-${index}`);

  it("refuses more than 100 genres", async () => {
    const errors = await errorsOf({ name: "Crass", genre: manyGenres(101) });
    expect(errors.genre?.message).toBe("A list cannot hold more than 100 entries.");
  });

  it("accepts exactly 100 genres", async () => {
    const errors = await errorsOf({ name: "Crass", genre: manyGenres(100) });
    expect(errors.genre).toBeUndefined();
  });

  it("refuses more than 100 albums", async () => {
    const albums = Array.from({ length: 101 }, (unused, index) => ({ title: `album-${index}` }));
    expect((await errorsOf({ name: "Crass", albums })).albums).toBeDefined();
  });
});

describe("Band schema — strict types", () => {
  it("refuses a number where a string belongs instead of casting it", async () => {
    // Without db/strict-types.ts, Mongoose would quietly store the name "42"
    expect((await errorsOf({ name: 42 })).name).toBeDefined();
  });

  it("refuses an album title that is not a string", async () => {
    expect(await errorsOf({ name: "Crass", albums: [{ title: 1977 }] })).not.toEqual({});
  });
});

describe("Band schema — defaults", () => {
  it("fills the optional fields so the frontend never reads undefined", () => {
    const band = new Band({ name: "Crass" });
    expect(band.country).toBe("");
    expect(band.status).toBe("");
    expect(band.genre).toEqual([]);
    expect(band.albums).toEqual([]);
    expect(band.members).toEqual([]);
    expect(band.type).toBe("Group");
    expect(band.disbanded).toBeNull();
    expect(band.image).toBeNull();
  });
});

// Where a band came from. Everything is editable either way: provenance is a
// credit, not a permission.
describe("Band schema — provenance", () => {
  it("assumes a band was typed by a human", () => {
    expect(new Band({ name: "Crass" }).source).toBe("manual");
  });

  it("accepts a band ingested from MusicBrainz", async () => {
    const errors = await errorsOf({ name: "Cro-Mags", source: "musicbrainz" });
    expect(errors.source).toBeUndefined();
  });

  it("refuses a source it does not know", async () => {
    expect((await errorsOf({ name: "Crass", source: "spotify" })).source).toBeDefined();
  });

  // Not null: a unique index counts null as a value, so two manual bands would
  // collide. The field has to be absent instead.
  it("leaves musicBrainzId unset on a manual band", () => {
    expect(new Band({ name: "Crass" }).musicBrainzId).toBeUndefined();
  });

  it("stores the MusicBrainz id when there is one", async () => {
    const band = await new Band({
      name: "Cro-Mags",
      source: "musicbrainz",
      musicBrainzId: "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae",
    }).save();

    expect(band.musicBrainzId).toBe("7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae");
  });

  // This index is what makes the ingestion idempotent: running it twice cannot
  // create the same band twice.
  it("refuses two bands with the same MusicBrainz id", async () => {
    await Band.init(); // the index is built by Mongo, not by a validator
    const fields = { source: "musicbrainz", musicBrainzId: "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae" };
    await new Band({ name: "Cro-Mags", ...fields }).save();

    await expect(new Band({ name: "Cro-Mags (other)", ...fields }).save())
      .rejects.toMatchObject({ code: 11000 });
  });

  it("still allows many bands with no MusicBrainz id at all", async () => {
    await Band.init();
    await new Band({ name: "Crass" }).save();

    await expect(new Band({ name: "Discharge" }).save()).resolves.toBeDefined();
  });
});

describe("Band schema — toJSON", () => {
  // Mongoose types toJSON() as the document itself, _id included: the transform is
  // invisible to the compiler. Hence the cast through unknown — and hence this test.
  it("renames _id to id and hides __v, which is what the frontend expects", async () => {
    const band = await new Band({ name: "Crass" }).save();
    const json = band.toJSON() as unknown as Record<string, unknown>;

    expect(json.id).toBe(band._id.toString());
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
  });

  it("adds createdAt and updatedAt", async () => {
    const band = await new Band({ name: "Crass" }).save();
    const json = band.toJSON() as unknown as Record<string, unknown>;

    expect(json.createdAt).toBeInstanceOf(Date);
    expect(json.updatedAt).toBeInstanceOf(Date);
  });
});
