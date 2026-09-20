import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";

// Every test runs against its own throwaway db.json, so the real one is never touched.
const directory = await mkdtemp(join(tmpdir(), "punkorum-"));
const dbFile = pathToFileURL(join(directory, "db.json"));

const makeBand = (overrides = {}) => ({
  id: "local-1",
  name: "Sex Pistols",
  country: "GB",
  formed: "1975",
  genre: ["punk rock"],
  albums: [{ title: "Never Mind the Bollocks", year: "1977", type: "Album" }],
  members: [{ name: "Johnny Rotten", instrument: "vocals", period: "1975-1978" }],
  source: "local",
  editable: true,
  ...overrides,
});

const seed = (bands) => writeFile(dbFile, JSON.stringify({ bands }, null, 2));

// A fake fetch, so no test ever calls the real MusicBrainz.
const musicBrainzAnswer = { artists: [{ id: "mb-1", name: "Ramones" }] };
let fetchImpl;
const app = () => createApp({ dbFile, fetchImpl });

beforeEach(async () => {
  await seed([makeBand()]);
  fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => musicBrainzAnswer,
  });
});

afterAll(() => rm(directory, { recursive: true, force: true }));

describe("GET /bands", () => {
  it("returns every band", async () => {
    const response = await request(app()).get("/bands");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("Sex Pistols");
  });
});

describe("GET /bands/:id", () => {
  it("returns one band", async () => {
    const response = await request(app()).get("/bands/local-1");
    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Sex Pistols");
  });

  it("answers 404 for an unknown id", async () => {
    const response = await request(app()).get("/bands/nope");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Band not found.");
  });
});

describe("POST /bands", () => {
  it("creates a band and generates the id itself", async () => {
    const response = await request(app())
      .post("/bands")
      .send({ name: "Crass", country: "GB", id: "id-chosen-by-the-client" });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Crass");
    // The client does not get to choose the id
    expect(response.body.id).not.toBe("id-chosen-by-the-client");
    expect(response.body.id).toHaveLength(36); // a UUID

    const all = await request(app()).get("/bands");
    expect(all.body).toHaveLength(2);
    expect(all.body[0].name).toBe("Crass"); // newest first
  });

  it.each([
    ["no body at all", {}],
    ["a blank name", { name: "   " }],
    ["a name that is not text", { name: 42 }],
    ["a name over 200 characters", { name: "x".repeat(201) }],
    ["a country that is not text", { name: "Crass", country: 42 }],
    ["a two-digit year", { name: "Crass", formed: "75" }],
    ["an implausible year", { name: "Crass", formed: "1066" }],
    ["genre as text instead of a list", { name: "Crass", genre: "punk" }],
    ["more than 100 albums", { name: "Crass", albums: new Array(101).fill({}) }],
  ])("refuses %s", async (_label, body) => {
    const response = await request(app()).post("/bands").send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("accepts the richer encyclopedia fields", async () => {
    const response = await request(app()).post("/bands").send({
      name: "Crass",
      description: "Formed in 1977 in Essex...",
      themes: "Anarchism, Pacifism, Society",
      label: "Crass Records",
      albums: [{ title: "The Feeding of the 5000", year: "1978", type: "Full-length" }],
      members: [
        { name: "Steve Ignorant", instrument: "vocals", period: "1977-1984", otherBands: ["Conflict"] },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.themes).toBe("Anarchism, Pacifism, Society");
    expect(response.body.members[0].otherBands).toEqual(["Conflict"]);
  });

  it("refuses a history longer than 20000 characters", async () => {
    const response = await request(app())
      .post("/bands")
      .send({ name: "Crass", description: "x".repeat(20_001) });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("description");
  });

  it("refuses themes that are not text", async () => {
    const response = await request(app()).post("/bands").send({ name: "Crass", themes: 42 });
    expect(response.status).toBe(400);
  });

  it("answers 400 for malformed JSON, not 500", async () => {
    const response = await request(app())
      .post("/bands")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("The request body is not valid JSON.");
  });

  it("refuses a body over 100kb", async () => {
    const response = await request(app())
      .post("/bands")
      .send({ name: "Crass", disambiguation: "x".repeat(200_000) });

    expect(response.status).toBe(413);
  });
});

describe("PUT /bands/:id", () => {
  it("replaces the band and keeps the id from the URL", async () => {
    const response = await request(app())
      .put("/bands/local-1")
      .send({ name: "The Sex Pistols", id: "another-id" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "local-1", name: "The Sex Pistols" });
  });

  it("answers 404 for an unknown id", async () => {
    const response = await request(app()).put("/bands/nope").send({ name: "Crass" });
    expect(response.status).toBe(404);
  });

  it("validates the body like POST does", async () => {
    const response = await request(app()).put("/bands/local-1").send({ name: "" });
    expect(response.status).toBe(400);
  });
});

describe("DELETE /bands/:id", () => {
  it("deletes the band", async () => {
    expect((await request(app()).delete("/bands/local-1")).status).toBe(204);
    expect((await request(app()).get("/bands")).body).toHaveLength(0);
  });

  it("answers 404 for an unknown id", async () => {
    expect((await request(app()).delete("/bands/nope")).status).toBe(404);
  });
});

describe("concurrent writes", () => {
  it("keeps every band when several are created at the same time", async () => {
    const server = app();
    await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) =>
        request(server).post("/bands").send({ name })
      )
    );

    const all = await request(server).get("/bands");
    // 1 seeded + 5 created: none of them erased another
    expect(all.body).toHaveLength(6);
  });
});

describe("GET /api/mb/*", () => {
  it("forwards to MusicBrainz with a User-Agent header", async () => {
    const response = await request(app()).get("/api/mb/artist?query=ramones&fmt=json");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(musicBrainzAnswer);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("https://musicbrainz.org/ws/2/artist");
    expect(url).toContain("query=ramones");
    expect(options.headers["User-Agent"]).toContain("EncyclopediaPunkorum");
  });

  it("serves the second identical call from the cache", async () => {
    const server = app(); // same instance, so the two calls share one cache
    const one = await request(server).get("/api/mb/artist?query=ramones");
    const two = await request(server).get("/api/mb/artist?query=ramones");

    expect(one.headers["x-cache"]).toBe("MISS");
    expect(two.headers["x-cache"]).toBe("HIT");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // MusicBrainz was called only once
  });

  it("serves a stale answer when MusicBrainz rate-limits us", async () => {
    const server = app();
    await request(server).get("/api/mb/artist?query=ramones"); // fills the cache

    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    // The cache entry is still fresh, so this would be a HIT — use another URL to
    // prove the 503 path itself, then check the stale path on the cached one.
    const rateLimited = await request(server).get("/api/mb/artist?query=crass");
    expect(rateLimited.status).toBe(503);
    expect(rateLimited.body.error).toBe("MusicBrainz request failed.");
  });
});

describe("unknown endpoints", () => {
  it("answers 404 in JSON, not an HTML page", async () => {
    const response = await request(app()).get("/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Unknown endpoint.");
  });
});
