// Types that belong to the Express API: options, error responses, MusicBrainz cache.

export interface CreateAppOptions {
  // Replaceable in the tests, so the real MusicBrainz is never called.
  fetchImpl?: typeof fetch;
  // Pause before retrying a rate-limited MusicBrainz call. The tests set it to 0.
  retryDelayMs?: number;
}

// Every error response of this API has this shape.
export interface ApiError {
  error: string;
}

// The errors thrown by express.json() that we turn into client errors.
export type BodyParserErrorType = "entity.parse.failed" | "entity.too.large";
