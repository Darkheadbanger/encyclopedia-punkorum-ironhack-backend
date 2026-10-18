// Business logic for reviews.
//
// What separates reviews from bands: a review has an owner. A valid token proves
// WHO you are, not that the review is yours — so modify and delete re-read the
// document and compare its author to the token before touching anything. Checking
// only that a token exists would let any member rewrite anyone's review.
//
// No try/catch: Express 5 forwards a rejected async handler to the error-handling
// middleware on its own.

import type { Request, Response } from "express";
import mongoose from "mongoose";
import Band from "../models/Band.model.ts";
import Review from "../models/Review.model.ts";

// Only the username of the author is ever sent: the model hides the password hash,
// but there is no reason to publish an email address either.
const AUTHOR_FIELDS = "username";

// The author, the id and the timestamps belong to the server. Otherwise anyone
// could sign a review with someone else's name, which is exactly what the
// ownership check below is meant to prevent.
//
// `band` survives here because createReview needs it; modifyReview drops it
// separately. A review belongs to one band for its whole life — letting an edit
// move it would hand a member the ability to re-aim their words at any band,
// including one that does not exist.
const fromClient = (body: unknown) => {
  const { id, _id, author, createdAt, updatedAt, ...data } = (body ?? {}) as Record<string, unknown>;
  return data;
};

// An id that is not an ObjectId is not a crash, just a review that does not exist.
// Handled here rather than in the central CastError branch, which answers with a
// band's wording.
// Express types a route parameter as string | string[]; both go through String().
const findReview = async (id: string | string[]) =>
  mongoose.isValidObjectId(String(id)) ? Review.findById(String(id)) : null;

const notFound = (res: Response) => {
  res.status(404).json({ error: "Review not found." });
};

// 403, not 401: the request IS authenticated, it is simply not allowed.
const refuse = (res: Response) => {
  res.status(403).json({ error: "This review belongs to someone else." });
};

export const getAllReviews = async (req: Request, res: Response) => {
  // ?band=<id> narrows the list to one band; without it, the latest of all.
  const band = req.query.band === undefined ? undefined : String(req.query.band);
  if (band !== undefined && !mongoose.isValidObjectId(band)) {
    res.status(400).json({ error: `"band" has the wrong type.` });
    return;
  }

  // _id breaks ties between reviews written in the same millisecond.
  res.json(
    await Review.find(band ? { band } : {})
      .populate("author", AUTHOR_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
  );
};

export const getOneReview = async (req: Request, res: Response) => {
  const review = await findReview(req.params.id);
  if (!review) {
    notFound(res);
    return;
  }
  res.json(await review.populate("author", AUTHOR_FIELDS));
};

export const createReview = async (req: Request, res: Response) => {
  // The band is read from the body here and NOWHERE ELSE: a review is about one
  // band for its whole life, so modifyReview strips it. It also has to exist —
  // the schema only checks that the id is an ObjectId, not that it points at
  // anything, and a review of a band that was never there reads as "A band that
  // is no longer here" on the page.
  const { band: claimed, ...data } = fromClient(req.body);
  const band = String(claimed ?? "");
  if (!mongoose.isValidObjectId(band) || !(await Band.exists({ _id: band }))) {
    res.status(400).json({ error: "This review is not about a band we hold." });
    return;
  }

  const review = await Review.create({
    ...data,
    band,
    author: req.payload!.id, // isAuthenticated guarantees the payload
  });
  res.status(201).json(await review.populate("author", AUTHOR_FIELDS));
};

export const modifyReview = async (req: Request, res: Response) => {
  const review = await findReview(req.params.id);
  if (!review) {
    notFound(res);
    return;
  }
  if (review.author.toString() !== req.payload!.id) {
    refuse(res);
    return;
  }

  // set() then save() rather than findByIdAndUpdate: the document is already
  // loaded for the ownership check, and save() runs the validators by default.
  // The band is dropped: an edit changes what you said, not what you said it about.
  const { band, ...data } = fromClient(req.body);
  review.set(data);
  await review.save();
  res.json(await review.populate("author", AUTHOR_FIELDS));
};

export const deleteReview = async (req: Request, res: Response) => {
  const review = await findReview(req.params.id);
  if (!review) {
    notFound(res);
    return;
  }
  if (review.author.toString() !== req.payload!.id) {
    refuse(res);
    return;
  }

  await review.deleteOne();
  res.status(204).end();
};
