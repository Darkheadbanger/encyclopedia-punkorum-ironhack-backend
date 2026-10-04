// The two ingestion routes.
//
// They are the only doors MusicBrainz data comes through, and both are server-side:
// a browser never talks to MusicBrainz. What lands in MongoDB is a Band like any
// other, editable and deletable.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import type { Test } from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "./app.ts";
import Band from "./models/Band.model.ts";

const CRO_MAGS_ID = "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae";

const token = jwt.sign(
  { id: "507f1f77bcf86cd799439099", email: "editor@punkorum.com", username: "editor" },
  process.env.TOKEN_SECRET!,
  { algorithm: "HS256", expiresIn: "1h" }
);
const asEditor = (call: Test) => call.set("Authorization", `Bearer ${token}`);

const croMags = {
  id: CRO_MAGS_ID,
  name: "Cro-Mags",
  country: "US",
  disambiguation: "New York hardcore band",
  tags: [{ name: "hardcore punk", count: 5 }],
  "life-span": { begin: "1981", ended: false },
  "begin-area": { name: "New York" },
  "release-groups": [
    { id: "r1", title: "The Age of Quarrel", "primary-type": "Album", "first-release-date": "1986-11" },
  ],
  relations: [
    { type: "member of band", begin: "1981", attributes: ["bass"], artist: { id: "a1", name: "Harley Flanagan" } },
  ],
};

let fetchImpl: Mock<typeof fetch>;

/** Answers the search endpoint with one artist, and the lookup with the full one. */
const musicBrainzReplies = (artists: unknown[] = [croMags], artist: unknown = croMags) =>
  vi.fn<typeof fetch>().mockImplementation(async (input) => ({
    ok: true,
    status: 200,
    json: async () => (String(input).includes("/artist?") ? { artists } : artist),
  } as Response));

const app = () => createApp({ fetchImpl, retryDelayMs: 0 });

beforeEach(async () => {
  await Band.deleteMany({});
  await Band.init(); // the unique index on musicBrainzId has to exist
  fetchImpl = musicBrainzReplies();
});

afterEach(() => vi.restoreAllMocks());

describe("GET /bands/upstream", () => {
  it("needs an account: searching costs an external call", async () => {
    const response = await request(app()).get("/bands/upstream?q=cro-mags");

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers with candidates already converted to our own shape", async () => {
    const response = await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      musicBrainzId: CRO_MAGS_ID,
      name: "Cro-Mags",
      country: "US",
      formed: "1981",
      status: "Active",
      genre: ["hardcore punk"],
      alreadyImported: false,
    });
  });

  it("identifies itself to MusicBrainz, as its rules require", async () => {
    await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("musicbrainz.org/ws/2/artist?");
    expect(String(url)).toContain("cro-mags");
    expect((options?.headers as Record<string, string>)["User-Agent"])
      .toContain("EncyclopediaPunkorum");
  });

  // Otherwise the page offers an Import button that can only fail.
  it("flags a candidate that is already in the encyclopedia", async () => {
    await new Band({ name: "Cro-Mags", source: "musicbrainz", musicBrainzId: CRO_MAGS_ID }).save();

    const response = await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));

    expect(response.body[0].alreadyImported).toBe(true);
  });

  it("asks for a search term instead of querying everything", async () => {
    const response = await asEditor(request(app()).get("/bands/upstream?q=  "));

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers an empty list when MusicBrainz knows nobody", async () => {
    fetchImpl = musicBrainzReplies([]);
    const response = await asEditor(request(app()).get("/bands/upstream?q=zzzz"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("skips an artist with no name rather than failing the whole search", async () => {
    fetchImpl = musicBrainzReplies([{ id: "x", name: "  " }, croMags]);
    const response = await asEditor(request(app()).get("/bands/upstream?q=cro"));

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  // The route must be declared before /bands/:id, or "upstream" is read as an id.
  it("is not shadowed by GET /bands/:id", async () => {
    const response = await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));
    expect(response.status).not.toBe(404);
  });

  it("answers 502 when MusicBrainz is unreachable", async () => {
    fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));

    expect(response.status).toBe(502);
    expect(response.text).not.toContain("network down"); // no leak
  });

  it("retries once when MusicBrainz answers 503, then succeeds", async () => {
    let call = 0;
    fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      call++;
      return call === 1
        ? ({ ok: false, status: 503, json: async () => ({}) } as Response)
        : ({ ok: true, status: 200, json: async () => ({ artists: [croMags] }) } as Response);
    });

    const response = await asEditor(request(app()).get("/bands/upstream?q=cro-mags"));

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("POST /bands/import", () => {
  const importIt = (musicBrainzId = CRO_MAGS_ID) =>
    asEditor(request(app()).post("/bands/import").send({ musicBrainzId }));

  it("needs an account", async () => {
    const response = await request(app()).post("/bands/import").send({ musicBrainzId: CRO_MAGS_ID });
    expect(response.status).toBe(401);
  });

  it("stores the band and returns it as one of ours", async () => {
    const response = await importIt();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: "Cro-Mags",
      source: "musicbrainz",
      musicBrainzId: CRO_MAGS_ID,
      location: "New York",
    });
    expect(response.body.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("brings the discography and the members along", async () => {
    const response = await importIt();

    expect(response.body.albums).toEqual([
      { title: "The Age of Quarrel", year: "1986", type: "Full-length" },
    ]);
    expect(response.body.members).toEqual([
      { name: "Harley Flanagan", instrument: "bass", period: "1981-" },
    ]);
  });

  // The whole point of the architecture: once imported, it is just a band.
  it("makes the imported band editable and deletable like any other", async () => {
    const { body } = await importIt();

    const edited = await asEditor(
      request(app()).put(`/bands/${body.id}`).send({ name: "Cro-Mags (NYHC)" })
    );
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe("Cro-Mags (NYHC)");
    expect(edited.body.source).toBe("musicbrainz"); // the credit survives the edit

    const deleted = await asEditor(request(app()).delete(`/bands/${body.id}`));
    expect(deleted.status).toBe(204);
  });

  it("appears in GET /bands right away: the list is the database", async () => {
    await importIt();

    const all = await request(app()).get("/bands");
    expect(all.body.map((band: { name: string }) => band.name)).toContain("Cro-Mags");
  });

  it("asks MusicBrainz for the releases and the line-up in one call", async () => {
    await importIt();

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain(`/artist/${CRO_MAGS_ID}`);
    expect(url).toContain("release-groups");
    expect(url).toContain("artist-rels");
    expect(url).toContain("tags");
  });

  it("refuses to import the same band twice", async () => {
    await importIt();

    const again = await importIt();

    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already/i);
    expect(await Band.countDocuments({ musicBrainzId: CRO_MAGS_ID })).toBe(1);
  });

  it("asks for an id instead of guessing", async () => {
    const response = await asEditor(request(app()).post("/bands/import").send({}));

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 404 when MusicBrainz does not know the id", async () => {
    fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      { ok: false, status: 404, json: async () => ({}) } as Response
    );

    const response = await importIt("11111111-1111-1111-1111-111111111111");

    expect(response.status).toBe(404);
    expect(await Band.countDocuments()).toBe(0);
  });
});
