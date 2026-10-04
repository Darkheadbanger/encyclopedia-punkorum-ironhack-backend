// Business logic for bands.
//
// No try/catch: Express 5 forwards a rejected async handler to the error-handling
// middleware on its own. app.test.ts locks that behaviour in.

import type { Request, Response } from "express";
import Band from "../models/Band.model.ts";

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

// The server owns the id and the provenance, never the client. A band created
// through the API is manual by definition; only the ingestion writes the other two.
const fromClient = (body: unknown) => {
  const { id, _id, source, musicBrainzId, ...data } = (body ?? {}) as Record<string, unknown>;
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
  res.status(204).end();
};
