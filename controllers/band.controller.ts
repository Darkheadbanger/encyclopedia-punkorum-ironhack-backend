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

export const createBand = async (req: Request, res: Response) => {
  // The server owns the id, never the client.
  const { id, _id, ...data } = req.body ?? {};
  res.status(201).json(await Band.create(data));
};

export const modifyBand = async (req: Request, res: Response) => {
  const { id, _id, ...data } = req.body ?? {};
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
