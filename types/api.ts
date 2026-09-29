// Les types propres à l'API Express : options, réponses d'erreur, cache MusicBrainz.

export interface CreateAppOptions {
  // Remplaçable dans les tests, pour ne jamais appeler le vrai MusicBrainz.
  fetchImpl?: typeof fetch;
  // Pause avant de retenter un appel MusicBrainz limité. Les tests la mettent à 0.
  retryDelayMs?: number;
}

// Toute réponse d'erreur de l'API a cette forme.
export interface ApiError {
  error: string;
}

// Valeur de l'en-tête X-Cache renvoyé par le proxy MusicBrainz.
export type CacheStatus = "HIT" | "MISS" | "STALE";

export interface CacheEntry {
  expiresAt: number; // timestamp en millisecondes
  body: unknown;
}

// Les erreurs levées par express.json() que l'on traduit en erreur client.
export type BodyParserErrorType = "entity.parse.failed" | "entity.too.large";
