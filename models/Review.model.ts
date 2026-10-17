// The Review model: what a member thinks of a band.
//
// Unlike albums and members, a review is NOT embedded in its band. An album is
// never read without its band; a review is — "the latest reviews", "everything
// this member wrote" — and it belongs to the person who signed it, not to the
// band. Hence its own collection and two references.
//
// Validation lives in the schema, like everywhere else here: no route can write a
// review with no text or a rating of 11, even a route that forgot to check.

import mongoose from "mongoose";
import "../db/strict-types.ts"; // rejects { rating: "5" } instead of casting it to 5
import type { Review } from "../types/index.ts";

const MIN_CONTENT = 10;
const MAX_CONTENT = 5000;
const MIN_RATING = 1;
const MAX_RATING = 5;

const reviewSchema = new mongoose.Schema<Review>({
  content: {
    type: String,
    required: [true, "A review needs something to say."],
    trim: true,
    minlength: [MIN_CONTENT, `A review must be at least ${MIN_CONTENT} characters long.`],
    maxlength: [MAX_CONTENT, `A review must be shorter than ${MAX_CONTENT} characters.`],
  },
  rating: {
    type: Number,
    required: [true, "A review needs a rating."],
    min: [MIN_RATING, `The lowest rating is ${MIN_RATING}.`],
    max: [MAX_RATING, `The highest rating is ${MAX_RATING}.`],
    // min/max alone would accept 3.7 stars.
    validate: {
      validator: Number.isInteger,
      message: "A rating is a whole number of stars.",
    },
  },
  // Written by the server from the verified token, never by the client: the
  // controller strips it from the body. Same reasoning as a band's provenance.
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "A review needs an author."],
  },
  band: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Band",
    required: [true, "A review is about a band."],
  },
}, {
  timestamps: true, // adds createdAt and updatedAt automatically

  // Same translation as Band and User: Mongo's _id becomes the id the frontend
  // expects, and __v never leaves.
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (document, { _id, ...object }) => ({ id: _id.toString(), ...object }),
  },
});

// Reviews are almost always read for one band, newest first. Without this index
// Mongo reads the whole collection to answer that.
reviewSchema.index({ band: 1, createdAt: -1 });

export default mongoose.model<Review>("Review", reviewSchema);
