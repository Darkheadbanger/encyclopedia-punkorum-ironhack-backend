import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import request from "supertest";
import type { Test } from "supertest";
import jwt from "jsonwebtoken";
import type { HydratedDocument } from "mongoose";
import { createApp } from "./app.ts";
import Band from "./models/Band.model.ts";
import type { Band as BandFields } from "./types/index.ts";

// The in-memory MongoDB is started by test/setup.ts.

// This file tests the bands API, not authentication, so the token is signed here
// rather than obtained through /auth — faster, and one less thing to break.
// auth.test.ts covers the real signup/login path.
const token = jwt.sign(
  { id: "507f1f77bcf86cd799439099", email: "editor@punkorum.com", username: "editor" },
  process.env.TOKEN_SECRET!,
  { algorithm: "HS256", expiresIn: "1h" }
);
const asEditor = (call: Test) => call.set("Authorization", `Bearer ${token}`);

const makeBand = (overrides = {}) => ({
  name: "Sex Pistols",
  country: "GB",
  formed: "1975",
  genre: ["punk rock"],
  albums: [{ title: "Never Mind the Bollocks", year: "1977", type: "Album" }],
  members: [{ name: "Johnny Rotten", instrument: "vocals", period: "1975-1978" }],
  ...overrides,
});

// A fake fetch, so no test ever calls the real MusicBrainz.
const musicBrainzAnswer = { artists: [{ id: "mb-1", name: "Ramones" }] };
let fetchImpl: Mock<typeof fetch>;
const app = (options: Partial<Parameters<typeof createApp>[0]> = {}) =>
  createApp({ fetchImpl, retryDelayMs: 0, ...options });

let seeded: HydratedDocument<BandFields>;

beforeEach(async () => {
  await Band.deleteMany({});
  seeded = await new Band(makeBand()).save();
  fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => musicBrainzAnswer,
  } as Response);
});

afterEach(() => vi.restoreAllMocks());

describe("GET /bands", () => {
  it("returns every band", async () => {
    const response = await request(app()).get("/bands");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("Sex Pistols");
  });

  it("exposes id, never _id or __v", async () => {
    const response = await request(app()).get("/bands");
    expect(response.body[0].id).toBe(seeded.id);
    expect(response.body[0]).not.toHaveProperty("_id");
    expect(response.body[0]).not.toHaveProperty("__v");
  });
});

describe("GET /bands/:id", () => {
  it("returns one band", async () => {
    const response = await request(app()).get(`/bands/${seeded.id}`);
    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Sex Pistols");
  });

  it("answers 404 for an id that does not exist", async () => {
    const response = await request(app()).get("/bands/507f1f77bcf86cd799439011");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Band not found.");
  });

  it("answers 404 for an id that is not an ObjectId", async () => {
    const response = await request(app()).get("/bands/nope");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Band not found.");
  });
});

describe("POST /bands", () => {
  it("creates a band and generates the id itself", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({ name: "Crass", country: "GB", id: "id-chosen-by-the-client" })
    );

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Crass");
    // The client does not get to choose the id
    expect(response.body.id).not.toBe("id-chosen-by-the-client");
    expect(response.body.id).toMatch(/^[0-9a-f]{24}$/); // an ObjectId

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
    ["an album without a title", { name: "Crass", albums: [{ year: "1978" }] }],
  ])("refuses %s", async (_label, body) => {
    const response = await asEditor(request(app()).post("/bands").send(body));
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("accepts the richer encyclopedia fields", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({
        name: "Crass",
        description: "Formed in 1977 in Essex...",
        themes: "Anarchism, Pacifism, Society",
        label: "Crass Records",
        albums: [{ title: "The Feeding of the 5000", year: "1978", type: "Full-length" }],
        members: [
          { name: "Steve Ignorant", instrument: "vocals", period: "1977-1984", otherBands: ["Conflict"] },
        ],
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.themes).toBe("Anarchism, Pacifism, Society");
    expect(response.body.members[0].otherBands).toEqual(["Conflict"]);
  });

  it("refuses a history longer than 20000 characters", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({ name: "Crass", description: "x".repeat(20_001) })
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("description");
  });

  it("refuses themes that are not text", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({ name: "Crass", themes: 42 })
    );
    expect(response.status).toBe(400);
  });

  it("answers 400 for malformed JSON, not 500", async () => {
    const response = await asEditor(
      request(app()).post("/bands").set("Content-Type", "application/json").send("{not json")
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("The request body is not valid JSON.");
  });

  it("refuses a body over 100kb", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({ name: "Crass", disambiguation: "x".repeat(200_000) })
    );

    expect(response.status).toBe(413);
  });
});

describe("PUT /bands/:id", () => {
  it("updates the band and keeps the id from the URL", async () => {
    const response = await asEditor(
      request(app()).put(`/bands/${seeded.id}`).send({ name: "The Sex Pistols", id: "another-id" })
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: seeded.id, name: "The Sex Pistols" });
  });

  it("answers 404 for an unknown id", async () => {
    const response = await asEditor(
      request(app()).put("/bands/507f1f77bcf86cd799439011").send({ name: "Crass" })
    );
    expect(response.status).toBe(404);
  });

  it("validates the body like POST does", async () => {
    const response = await asEditor(request(app()).put(`/bands/${seeded.id}`).send({ name: "" }));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /bands/:id", () => {
  it("deletes the band", async () => {
    expect((await asEditor(request(app()).delete(`/bands/${seeded.id}`))).status).toBe(204);
    expect((await request(app()).get("/bands")).body).toHaveLength(0);
  });

  it("answers 404 for an unknown id", async () => {
    const response = await asEditor(request(app()).delete("/bands/507f1f77bcf86cd799439011"));
    expect(response.status).toBe(404);
  });
});

describe("concurrent writes", () => {
  it("keeps every band when several are created at the same time", async () => {
    const server = app();
    await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) =>
        asEditor(request(server).post("/bands").send({ name }))
      )
    );

    const all = await request(server).get("/bands");
    expect(all.body).toHaveLength(6); // 1 seeded + 5 created, none erased another
  });
});

// Guards the contract the controllers rely on: an unexpected failure must reach the
// central error handler and come back as a generic 500 — never a leaked stack trace,
// never a hanging request. This is what lets the controllers skip try/catch.
describe("unexpected errors reach the central handler", () => {
  it.each([
    ["GET /bands", "find" as const, (server: ReturnType<typeof app>) => request(server).get("/bands")],
    ["GET /bands/:id", "findById" as const, (server: ReturnType<typeof app>) => request(server).get("/bands/507f1f77bcf86cd799439011")],
    ["POST /bands", "create" as const, (server: ReturnType<typeof app>) => asEditor(request(server).post("/bands").send({ name: "Crass" }))],
    ["PUT /bands/:id", "findByIdAndUpdate" as const, (server: ReturnType<typeof app>) => asEditor(request(server).put("/bands/507f1f77bcf86cd799439011").send({ name: "Crass" }))],
    ["DELETE /bands/:id", "findByIdAndDelete" as const, (server: ReturnType<typeof app>) => asEditor(request(server).delete("/bands/507f1f77bcf86cd799439011"))],
  ])("%s answers 500 when the database throws", async (_label, method, call) => {
    vi.spyOn(Band, method).mockRejectedValue(new Error("database is down") as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call(app());

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Something went wrong on the server.");
    expect(response.text).not.toContain("database is down"); // no leak
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
    expect((options?.headers as Record<string, string>)["User-Agent"]).toContain("EncyclopediaPunkorum");
  });

  it("serves the second identical call from the cache", async () => {
    const server = app(); // same instance, so the two calls share one cache
    const one = await request(server).get("/api/mb/artist?query=ramones");
    const two = await request(server).get("/api/mb/artist?query=ramones");

    expect(one.headers["x-cache"]).toBe("MISS");
    expect(two.headers["x-cache"]).toBe("HIT");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // MusicBrainz was called only once
  });

  it("answers 503 when MusicBrainz rate-limits us and nothing is cached", async () => {
    const server = app();
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);

    const rateLimited = await request(server).get("/api/mb/artist?query=crass");
    expect(rateLimited.status).toBe(503);
    expect(rateLimited.body.error).toBe("MusicBrainz request failed.");
  });

  it("serves the stale answer when MusicBrainz fails after a successful call", async () => {
    const server = app();
    await request(server).get("/api/mb/artist?query=ramones"); // fills the cache

    vi.setSystemTime(Date.now() + 6 * 60 * 1000); // past the 5-minute TTL
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);

    const stale = await request(server).get("/api/mb/artist?query=ramones");
    expect(stale.headers["x-cache"]).toBe("STALE");
    expect(stale.body).toEqual(musicBrainzAnswer);
    vi.useRealTimers();
  });
});

// MusicBrainz allows about one request per second and answers 503 above that.
// One retry turns the most common failure into a non-event for the visitor.
describe("GET /api/mb/* retries a rate-limited call", () => {
  const rateLimited = { ok: false, status: 503, json: async () => ({}) } as Response;
  const answered = { ok: true, json: async () => musicBrainzAnswer } as Response;

  it("retries once and serves the answer", async () => {
    fetchImpl.mockResolvedValueOnce(rateLimited).mockResolvedValueOnce(answered);

    const response = await request(app()).get("/api/mb/artist?query=crass");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(musicBrainzAnswer);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waits before retrying instead of hammering MusicBrainz", async () => {
    fetchImpl.mockResolvedValueOnce(rateLimited).mockResolvedValueOnce(answered);
    const started = Date.now();

    await request(app({ retryDelayMs: 60 })).get("/api/mb/artist?query=crass");

    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it("gives up after a second 503", async () => {
    fetchImpl.mockResolvedValue(rateLimited);

    const response = await request(app()).get("/api/mb/artist?query=crass");

    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one retry, not an endless loop
  });

  it("does not retry an error that will not fix itself", async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);

    const response = await request(app()).get("/api/mb/artist?query=nothing");

    expect(response.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // retrying a 404 changes nothing
  });
});

describe("unknown endpoints", () => {
  it("answers 404 in JSON, not an HTML page", async () => {
    const response = await request(app()).get("/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Unknown endpoint.");
  });
});
