// The /reviews API over HTTP.
//
// The point of this file is the line the bands never had to draw: being logged in
// is enough to WRITE a review, but not to touch someone else's. Every test below
// that ends in 403 is there because a token proves identity, not ownership.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Test } from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";
import { createApp } from "./app.ts";
import Band from "./models/Band.model.ts";
import Review from "./models/Review.model.ts";
import User from "./models/User.model.ts";
import type { Band as BandFields, Review as ReviewFields } from "./types/index.ts";

// The in-memory MongoDB is started by test/setup.ts.

const app = () => createApp();

// Two members, so "someone else's review" is a real case and not a hypothesis.
const tokenFor = (id: string, username: string) =>
  jwt.sign({ id, email: `${username}@punkorum.com`, username }, process.env.TOKEN_SECRET!, {
    algorithm: "HS256",
    expiresIn: "1h",
  });

const as = (call: Test, token: string) => call.set("Authorization", `Bearer ${token}`);

const validReview = (band: string, overrides = {}) => ({
  content: "Three chords and the truth, still the loudest record of 1977.",
  rating: 5,
  band,
  ...overrides,
});

let band: HydratedDocument<BandFields>;
let author: HydratedDocument<{ email: string; password: string; username: string }>;
let stranger: HydratedDocument<{ email: string; password: string; username: string }>;
let authorToken: string;
let strangerToken: string;
let seeded: HydratedDocument<ReviewFields>;

beforeEach(async () => {
  await Promise.all([Review.deleteMany({}), Band.deleteMany({}), User.deleteMany({})]);

  band = await new Band({ name: "Sex Pistols", formed: "1975" }).save();
  author = await new User({
    email: "joe@punkorum.com", password: "strummer77", username: "joe",
  }).save();
  stranger = await new User({
    email: "sid@punkorum.com", password: "vicious77", username: "sid",
  }).save();

  authorToken = tokenFor(author._id.toString(), "joe");
  strangerToken = tokenFor(stranger._id.toString(), "sid");

  seeded = await new Review({
    ...validReview(band._id.toString()),
    author: author._id,
  }).save();
});

describe("GET /reviews", () => {
  it("returns every review, newest first", async () => {
    const response = await request(app()).get("/reviews");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].rating).toBe(5);
  });

  it("needs no token: an encyclopedia is meant to be read", async () => {
    expect((await request(app()).get("/reviews")).status).toBe(200);
  });

  it("sends the author's username, never their email or password", async () => {
    const [review] = (await request(app()).get("/reviews")).body;

    expect(review.author.username).toBe("joe");
    expect(review.author.email).toBeUndefined();
    expect(review.author.password).toBeUndefined();
  });

  it("exposes id, never _id or __v", async () => {
    const [review] = (await request(app()).get("/reviews")).body;

    expect(review.id).toBe(seeded._id.toString());
    expect(review._id).toBeUndefined();
    expect(review.__v).toBeUndefined();
  });

  it("narrows to one band with ?band=", async () => {
    const other = await new Band({ name: "Crass" }).save();
    const response = await request(app()).get(`/reviews?band=${other._id}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(0);
  });

  it("answers 400 when ?band= is not an id", async () => {
    const response = await request(app()).get("/reviews?band=hello");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/wrong type/);
  });
});

describe("GET /reviews/:id", () => {
  it("returns the review", async () => {
    const response = await request(app()).get(`/reviews/${seeded._id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(seeded._id.toString());
  });

  it("answers 404 for an unknown id", async () => {
    const response = await request(app()).get(`/reviews/${new mongoose.Types.ObjectId()}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Review not found.");
  });

  // An id that is not an ObjectId is a review that does not exist, not a crash.
  it("answers 404 for an id that is not an ObjectId", async () => {
    const response = await request(app()).get("/reviews/hello");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Review not found.");
  });
});

describe("POST /reviews", () => {
  it("refuses an anonymous review", async () => {
    const response = await request(app()).post("/reviews").send(validReview(band._id.toString()));

    expect(response.status).toBe(401);
    expect(await Review.countDocuments()).toBe(1);
  });

  it("creates the review for a logged-in member", async () => {
    const response = await as(request(app()).post("/reviews"), authorToken)
      .send(validReview(band._id.toString(), { content: "A record that still bites." }));

    expect(response.status).toBe(201);
    expect(response.body.content).toBe("A record that still bites.");
    expect(await Review.countDocuments()).toBe(2);
  });

  it("signs the review with the token, not with the body", async () => {
    // A client claiming to be someone else is simply ignored.
    const response = await as(request(app()).post("/reviews"), strangerToken)
      .send(validReview(band._id.toString(), { author: author._id.toString() }));

    expect(response.status).toBe(201);
    expect(response.body.author.username).toBe("sid");
  });

  it("answers 400 when the review says nothing", async () => {
    const response = await as(request(app()).post("/reviews"), authorToken)
      .send(validReview(band._id.toString(), { content: "" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("A review needs something to say.");
  });

  it("answers 400 for a rating out of range", async () => {
    const response = await as(request(app()).post("/reviews"), authorToken)
      .send(validReview(band._id.toString(), { rating: 11 }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("The highest rating is 5.");
  });
});

describe("PUT /reviews/:id", () => {
  it("refuses an anonymous edit", async () => {
    const response = await request(app()).put(`/reviews/${seeded._id}`).send({ rating: 1 });

    expect(response.status).toBe(401);
  });

  it("lets the author rewrite their own review", async () => {
    const response = await as(request(app()).put(`/reviews/${seeded._id}`), authorToken)
      .send({ content: "On reflection, the bass is doing all the work.", rating: 4 });

    expect(response.status).toBe(200);
    expect(response.body.rating).toBe(4);
    expect((await Review.findById(seeded._id))!.rating).toBe(4);
  });

  // The whole reason this model exists as a separate file.
  it("refuses an edit from another member, with 403 and not 401", async () => {
    const response = await as(request(app()).put(`/reviews/${seeded._id}`), strangerToken)
      .send({ rating: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("This review belongs to someone else.");
    expect((await Review.findById(seeded._id))!.rating).toBe(5);
  });

  it("cannot be used to steal a review", async () => {
    await as(request(app()).put(`/reviews/${seeded._id}`), authorToken)
      .send({ author: stranger._id.toString() });

    expect((await Review.findById(seeded._id))!.author.toString()).toBe(author._id.toString());
  });

  it("still validates what it writes", async () => {
    const response = await as(request(app()).put(`/reviews/${seeded._id}`), authorToken)
      .send({ rating: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("The lowest rating is 1.");
  });

  it("answers 404 for an unknown id", async () => {
    const response = await as(
      request(app()).put(`/reviews/${new mongoose.Types.ObjectId()}`), authorToken
    ).send({ rating: 2 });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /reviews/:id", () => {
  it("refuses an anonymous delete", async () => {
    const response = await request(app()).delete(`/reviews/${seeded._id}`);

    expect(response.status).toBe(401);
    expect(await Review.countDocuments()).toBe(1);
  });

  it("lets the author delete their own review", async () => {
    const response = await as(request(app()).delete(`/reviews/${seeded._id}`), authorToken);

    expect(response.status).toBe(204);
    expect(await Review.countDocuments()).toBe(0);
  });

  it("refuses a delete from another member, with 403 and not 401", async () => {
    const response = await as(request(app()).delete(`/reviews/${seeded._id}`), strangerToken);

    expect(response.status).toBe(403);
    expect(await Review.countDocuments()).toBe(1);
  });

  it("answers 404 for an unknown id", async () => {
    const response = await as(
      request(app()).delete(`/reviews/${new mongoose.Types.ObjectId()}`), authorToken
    );

    expect(response.status).toBe(404);
  });
});

// Three things the client is not allowed to decide. Each one was accepted until
// a code review tried it.
describe("what a review's author cannot set", () => {
  it("refuses a review about a band that does not exist", async () => {
    const response = await as(request(app()).post("/reviews"), authorToken)
      .send(validReview(new mongoose.Types.ObjectId().toString()));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not about a band we hold/i);
  });

  it("refuses a review whose band is not even an id", async () => {
    const response = await as(request(app()).post("/reviews"), authorToken)
      .send(validReview("not-an-id"));

    expect(response.status).toBe(400);
  });

  // An edit changes what you said, not what you said it about.
  it("ignores an attempt to move a review to another band", async () => {
    const other = await new Band({ name: "Discharge" }).save();

    const response = await as(request(app()).put(`/reviews/${seeded._id}`), authorToken)
      .send({ band: other._id.toString(), rating: 3 });

    expect(response.status).toBe(200);
    expect((await Review.findById(seeded._id))!.band.toString()).toBe(band._id.toString());
    expect((await Review.findById(seeded._id))!.rating).toBe(3); // the rest still applies
  });
});

// A review is about a band. Deleting the band used to leave its reviews behind,
// showing as "A band that is no longer here" on a page that offers no Delete —
// so not even their author could get rid of them.
describe("deleting a band takes its reviews with it", () => {
  it("removes the reviews of the deleted band", async () => {
    const response = await as(request(app()).delete(`/bands/${band._id}`), authorToken);

    expect(response.status).toBe(204);
    expect(await Review.countDocuments({ band: band._id })).toBe(0);
  });

  it("leaves other bands' reviews alone", async () => {
    const other = await new Band({ name: "Discharge" }).save();
    const survivor = await new Review({
      ...validReview(other._id.toString()),
      author: author._id,
    }).save();

    await as(request(app()).delete(`/bands/${band._id}`), authorToken);

    expect(await Review.findById(survivor._id)).not.toBeNull();
  });

  // The band was never there, so neither were its reviews: nothing may be touched.
  it("touches nothing when the band does not exist", async () => {
    const response = await as(
      request(app()).delete(`/bands/${new mongoose.Types.ObjectId()}`), authorToken
    );

    expect(response.status).toBe(404);
    expect(await Review.countDocuments()).toBe(1);
  });
});
