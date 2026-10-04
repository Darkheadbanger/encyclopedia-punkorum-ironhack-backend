// The User model: an account that can log into the encyclopedia.
//
// The password is NEVER stored in clear text: the pre("save") hook below hashes it
// with bcrypt. The minlength applies to the plaintext because Mongoose validates
// before running the hook.

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import "../db/strict-types.ts"; // rejects { email: 42 } instead of casting it to "42"
import type { User } from "../types/index.ts";

const MIN_PASSWORD = 8;
const SALT_ROUNDS = 10;

// Deliberately simple: something@something.extension, with no spaces.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema<User>({
  email: {
    type: String,
    required: [true, "An email is required."],
    unique: true, // creates a unique index in Mongo: no two accounts share an email
    lowercase: true,
    trim: true,
    match: [EMAIL_REGEX, "This email is not valid."],
  },
  password: {
    type: String,
    required: [true, "A password is required."],
    minlength: [MIN_PASSWORD, `The password must be at least ${MIN_PASSWORD} characters long.`],
  },
  username: {
    type: String,
    required: [true, "A username is required."],
    trim: true,
  },
}, {
  timestamps: true, // adds createdAt and updatedAt automatically

  // Same translation as Band (_id -> id), and above all: the password hash never
  // leaves in a JSON response, even if a route forgets to strip it.
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (document, { _id, password, ...object }) => ({ id: _id.toString(), ...object }),
  },
});

// Hashing lives here, not in the route: no code path can write a plaintext
// password, not even a script or a seed that forgot to hash it.
//
// Mongoose validates BEFORE running this hook, so the schema's minlength really
// applies to the typed password, not to the hash.
// An async hook receives no `next` callback: returning is enough.
userSchema.pre("save", async function hashPassword() {
  // Without this check, changing an email would re-hash an already hashed password.
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  this.password = await bcrypt.hash(this.password, salt);
});

export default mongoose.model<User>("User", userSchema);
