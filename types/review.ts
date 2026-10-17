// The types of a review: what a member wrote about a band. The Mongoose schema
// (models/Review.model.ts) builds on this interface.

import type { Types } from "mongoose";

export interface Review {
  content: string;
  rating: number;
  // References, not embedded copies: a review outlives the page it was read on,
  // and its author is an account that exists on its own.
  author: Types.ObjectId;
  band: Types.ObjectId;
}
