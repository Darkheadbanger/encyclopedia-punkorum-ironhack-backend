// The Band model: a punk band in the encyclopedia.
//
// Validation now lives IN the schema (required, maxlength, match...). That is the
// big difference with the old validateBand() function: Mongoose refuses to write an
// invalid document even if a route forgets to check. The route only has to turn the
// Mongoose error into an HTTP 400.

import mongoose from "mongoose";
import "../db/strict-types.ts"; // rejects { name: 42 } instead of casting it to "42"
import type { Album, Band, Member } from "../types/index.ts";

const MAX_NAME = 200;
const MAX_TEXT = 500;
const MAX_LIST = 100;
const MAX_DESCRIPTION = 20000;

// A plausible year: 4 digits, between 1900 and next year.
const validYear = {
  validator: (value: string | null | undefined) => {
    if (value == null || value === "") return true; // the field is optional
    if (!/^\d{4}$/.test(value)) return false;
    return Number(value) >= 1900 && Number(value) <= new Date().getFullYear() + 1;
  },
  message: (props: { value: unknown }) => `"${props.value}" is not a plausible year (1900-${new Date().getFullYear() + 1}).`,
};

const shortList = {
  validator: (list: unknown[] | undefined) => !list || list.length <= MAX_LIST,
  message: `A list cannot hold more than ${MAX_LIST} entries.`,
};

// Albums and members are EMBEDDED in the band, not kept in their own collection:
// they are never read without their band. This is exactly the case where Mongo's
// document model is simpler than a separate table.
const albumSchema = new mongoose.Schema<Album>({
  title: { type: String, required: true, trim: true, maxlength: MAX_TEXT },
  year: { type: String, trim: true, validate: validYear },
  type: { type: String, trim: true, maxlength: MAX_TEXT },
}, { _id: false });

const memberSchema = new mongoose.Schema<Member>({
  name: { type: String, required: true, trim: true, maxlength: MAX_TEXT },
  instrument: { type: String, trim: true, maxlength: MAX_TEXT },
  period: { type: String, trim: true, maxlength: MAX_TEXT },
  otherBands: { type: [String], default: undefined, validate: shortList },
}, { _id: false });

const bandSchema = new mongoose.Schema<Band>({
  name: {
    type: String,
    required: [true, "A band needs a name."],
    trim: true,
    maxlength: [MAX_NAME, `The name must be shorter than ${MAX_NAME} characters.`],
  },
  country: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  location: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  status: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  formed: { type: String, trim: true, validate: validYear, default: "" },
  disbanded: { type: String, trim: true, validate: validYear, default: null },
  genre: { type: [String], default: [], validate: shortList },
  disambiguation: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  image: { type: String, trim: true, default: null },
  albums: { type: [albumSchema], default: [], validate: shortList },
  members: { type: [memberSchema], default: [], validate: shortList },
  type: { type: String, trim: true, maxlength: MAX_TEXT, default: "Group" },
  description: { type: String, trim: true, maxlength: MAX_DESCRIPTION, default: "" },
  themes: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  label: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },

  // Provenance. The API owns these two: a client never sets them, the controllers
  // strip them from the request body.
  source: {
    type: String,
    enum: ["manual", "musicbrainz"],
    default: "manual",
  },
  // No default: the field must be ABSENT on a manual band. A unique index counts
  // null as a value, so two nulls would collide — sparse only skips missing fields.
  // This index is what makes the ingestion idempotent.
  musicBrainzId: {
    type: String,
    trim: true,
    maxlength: MAX_TEXT,
    unique: true,
    sparse: true,
  },
}, {
  timestamps: true, // adds createdAt and updatedAt automatically

  // Mongo names its key "_id" and adds "__v". The frontend expects "id". This
  // transform does the translation on the way out, which is why the Mongo
  // migration did not touch a single line of React.
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (document, { _id, ...object }) => ({ id: _id.toString(), ...object }),
  },
});

export default mongoose.model<Band>("Band", bandSchema);
