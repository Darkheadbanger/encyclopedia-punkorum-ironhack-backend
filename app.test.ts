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
  // Provenance belongs to the server. If a client could claim "musicbrainz" and
  // pick an id, it could also collide with a real ingested band.
  it("marks a band created through the API as manual, whatever the client claims", async () => {
    const response = await asEditor(
      request(app()).post("/bands").send({
        name: "Crass",
        source: "musicbrainz",
        musicBrainzId: "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae",
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.source).toBe("manual");
    expect(response.body.musicBrainzId).toBeUndefined();
  });

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

  // An edit must not be able to rewrite history: a band ingested from MusicBrainz
  // stays ingested, and a manual one cannot pretend it was.
  it("never lets an edit change the provenance", async () => {
    const response = await asEditor(
      request(app()).put(`/bands/${seeded.id}`).send({
        name: "The Sex Pistols",
        source: "musicbrainz",
        musicBrainzId: "7a2e6b55-f149-4e74-be6a-30a1b1a3e5ae",
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.source).toBe("manual");
    expect(response.body.musicBrainzId).toBeUndefined();
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

describe("unknown endpoints", () => {
  it("answers 404 in JSON, not an HTML page", async () => {
    const response = await request(app()).get("/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Unknown endpoint.");
  });
});
