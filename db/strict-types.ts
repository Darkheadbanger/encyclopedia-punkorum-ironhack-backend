// Makes Mongoose strict about types, for EVERY model.
//
// By default Mongoose is permissive: sending { name: 42 } stores the name "42"
// without complaining, and { genre: "punk" } becomes the list ["punk"]. An API that
// accepts any type also accepts the frontend's typos.
//
// cast(false) makes the conversion fail instead of guessing it: Mongoose then throws
// a ValidationError, which the central error handler turns into a 400.
//
// This file exports nothing: it is imported for its side effect. The models import
// it first, before declaring their schema.

import mongoose from "mongoose";

mongoose.Schema.Types.String.cast(false);
mongoose.Schema.Types.Number.cast(false);
mongoose.Schema.Types.Boolean.cast(false);
