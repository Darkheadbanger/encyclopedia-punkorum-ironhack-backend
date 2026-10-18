// The seed file, checked against the shapes the frontend actually filters on.
//
// This test exists because of a bug nobody saw for weeks: db.json stored release
// types as free text — "Album", "Live" — while the discography tabs filter on
// RELEASE_TYPES, which says "Full-length" and "Live album". 141 of the 151
// releases therefore appeared under "Complete" and nowhere else, and the "Main"
// tab showed eight EPs for the whole catalogue. Everything looked fine: the data
// was there, the tabs worked, they just never matched.
//
// The list below is copied from the frontend's src/types.ts on purpose. The two
// repositories cannot import from each other, so the duplication is the seam —
// and this test is what makes the seam fail loudly instead of silently.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const RELEASE_TYPES = [
  "Full-length", "EP", "Single", "Demo", "Live album",
  "Compilation", "Split", "Video", "Boxed set", "Bootleg",
];

const seeded = JSON.parse(readFileSync(new URL("./db.json", import.meta.url), "utf8")) as
  | { albums?: { title?: string; year?: string; type?: string }[]; name?: string }[]
  | { bands: { albums?: { title?: string; year?: string; type?: string }[]; name?: string }[] };

const bands = Array.isArray(seeded) ? seeded : seeded.bands;

describe("db.json — release types the frontend can filter", () => {
  it("holds bands with releases at all", () => {
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.flatMap((band) => band.albums ?? []).length).toBeGreaterThan(0);
  });

  it("uses only types the discography tabs know about", () => {
    const unknown = bands.flatMap((band) =>
      (band.albums ?? [])
        .filter((album) => album.type && !RELEASE_TYPES.includes(album.type))
        .map((album) => `${band.name}: "${album.type}"`)
    );

    expect(unknown).toEqual([]);
  });
});
