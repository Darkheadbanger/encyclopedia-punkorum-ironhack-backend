// The Review schema, tested directly rather than through HTTP.
//
// review.test.ts checks the status codes and the ownership rule; this file checks
// what a review is allowed to contain. A rule broken here is broken for every
// caller, route or script.

import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import Review from "./Review.model.ts";

const anId = () => new mongoose.Types.ObjectId();

const validFields = (overrides: Record<string, unknown> = {}) => ({
  content: "Three chords and the truth, still the loudest record of 1977.",
  rating: 5,
  author: anId(),
  band: anId(),
  ...overrides,
});

// validate() runs the validators without writing anything, so these tests stay
// fast; the ones that need an _id save for real.
const errorsOf = async (fields: Record<string, unknown>) => {
  try {
    await new Review(fields).validate();
    return {} as mongoose.Error.ValidationError["errors"];
  } catch (error) {
    return (error as mongoose.Error.ValidationError).errors;
  }
};

afterEach(async () => {
  await Review.deleteMany({});
});

describe("Review schema — required fields", () => {
  it("accepts a complete review", async () => {
    expect(await errorsOf(validFields())).toEqual({});
  });

  it("refuses a review with nothing to say", async () => {
    const errors = await errorsOf(validFields({ content: undefined }));
    expect(errors.content?.message).toBe("A review needs something to say.");
  });

  it("refuses a review with no rating", async () => {
    const errors = await errorsOf(validFields({ rating: undefined }));
    expect(errors.rating?.message).toBe("A review needs a rating.");
  });

  it("refuses a review attached to no band", async () => {
    const errors = await errorsOf(validFields({ band: undefined }));
    expect(errors.band?.message).toBe("A review is about a band.");
  });

  it("refuses a review signed by nobody", async () => {
    const errors = await errorsOf(validFields({ author: undefined }));
    expect(errors.author?.message).toBe("A review needs an author.");
  });
});

describe("Review schema — content", () => {
  it("refuses a one-word review", async () => {
    const errors = await errorsOf(validFields({ content: "Great." }));
    expect(errors.content?.message).toMatch(/at least 10 characters/);
  });

  it("refuses more than 5000 characters", async () => {
    const errors = await errorsOf(validFields({ content: "a".repeat(5001) }));
    expect(errors.content?.message).toMatch(/shorter than 5000/);
  });

  it("trims the surrounding whitespace", () => {
    expect(new Review(validFields({ content: "   A fine record indeed.   " })).content)
      .toBe("A fine record indeed.");
  });
});

describe("Review schema — rating", () => {
  it.each([1, 2, 3, 4, 5])("accepts %i star(s)", async (rating) => {
    expect((await errorsOf(validFields({ rating }))).rating).toBeUndefined();
  });

  it("refuses 0", async () => {
    expect((await errorsOf(validFields({ rating: 0 }))).rating?.message)
      .toBe("The lowest rating is 1.");
  });

  it("refuses 6", async () => {
    expect((await errorsOf(validFields({ rating: 6 }))).rating?.message)
      .toBe("The highest rating is 5.");
  });

  // min and max alone would let this one through.
  it("refuses half a star", async () => {
    expect((await errorsOf(validFields({ rating: 3.5 }))).rating?.message)
      .toBe("A rating is a whole number of stars.");
  });

  it("refuses a rating sent as a string instead of casting it", async () => {
    // Without db/strict-types.ts, Mongoose would quietly store the number 5.
    expect((await errorsOf(validFields({ rating: "5" }))).rating).toBeDefined();
  });
});

describe("Review schema — references", () => {
  it("refuses an author that is not an id", async () => {
    expect((await errorsOf(validFields({ author: "johnny" }))).author).toBeDefined();
  });

  it("points at the User and Band models", () => {
    expect(Review.schema.path("author").options.ref).toBe("User");
    expect(Review.schema.path("band").options.ref).toBe("Band");
  });
});

describe("Review schema — toJSON", () => {
  it("renames _id to id and hides __v, which is what the frontend expects", async () => {
    const review = await new Review(validFields()).save();
    const json = review.toJSON() as unknown as Record<string, unknown>;

    expect(json.id).toBe(review._id.toString());
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
  });

  it("adds createdAt and updatedAt", async () => {
    const review = await new Review(validFields()).save();
    const json = review.toJSON() as unknown as Record<string, unknown>;

    expect(json.createdAt).toBeInstanceOf(Date);
    expect(json.updatedAt).toBeInstanceOf(Date);
  });
});
