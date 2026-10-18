// Business logic for bands.
//
// No try/catch: Express 5 forwards a rejected async handler to the error-handling
// middleware on its own. app.test.ts locks that behaviour in.

import type { Request, Response } from "express";
import Band from "../models/Band.model.ts";
import Review from "../models/Review.model.ts";

export const getAllBands = async (req: Request, res: Response) => {
  // _id breaks ties between bands created in the same millisecond.
  res.json(await Band.find().sort({ createdAt: -1, _id: -1 }));
};

export const getOneBand = async (req: Request, res: Response) => {
  const band = await Band.findById(req.params.id);
  if (!band) {
    res.status(404).json({ error: "Band not found." });
    return;
  }
  res.json(band);
};

// The server owns the id, the provenance and the timestamps, never the client. A
// band created through the API is manual by definition; only the ingestion writes
// the other two.
//
// createdAt matters more than it looks: GET /bands sorts on it, so a band posted
// with createdAt in the year 2099 would sit at the top of the encyclopedia for
// the next seventy years. Mongoose overwrites it on update but honours it on
// create, which is why it has to be stripped here.
const fromClient = (body: unknown) => {
  const { id, _id, source, musicBrainzId, createdAt, updatedAt, ...data } =
    (body ?? {}) as Record<string, unknown>;
  return data;
};

export const createBand = async (req: Request, res: Response) => {
  res.status(201).json(await Band.create(fromClient(req.body)));
};

export const modifyBand = async (req: Request, res: Response) => {
  const data = fromClient(req.body);
  const band = await Band.findByIdAndUpdate(req.params.id, data, {
    returnDocument: "after",
    runValidators: true, // Mongoose only validates on create otherwise
  });
  if (!band) {
    res.status(404).json({ error: "Band not found." });
    return;
  }
  res.json(band);
};

export const deleteBand = async (req: Request, res: Response) => {
  const band = await Band.findByIdAndDelete(req.params.id);
  if (!band) {
    res.status(404).json({ error: "Band not found." });
    return;
  }

  // A review is about a band. Without this, deleting the band left its reviews
  // behind, showing on /reviews as "A band that is no longer here" — and since
  // that page offers no Edit or Delete, not even their author could remove them.
  // Deleted after the band, not before: if the band turns out not to exist, the
  // reviews must stay exactly where they are.
  await Review.deleteMany({ band: band._id });

  res.status(204).end();
};
