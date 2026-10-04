// The types of a punk band. The Mongoose schema (models/Band.model.ts) builds on
// these interfaces: if a field changes here, tsc flags the schema that did not follow.

export interface Album {
  title: string;
  year?: string;
  type?: string;
}

export interface Member {
  name: string;
  instrument?: string;
  period?: string;
  otherBands?: string[];
}

/** Where a band's data came from. It is a credit, not a permission: both are
 *  editable and deletable through the API. */
export type BandSource = "manual" | "musicbrainz";

export interface Band {
  name: string;
  source: BandSource;
  /** Set only on an ingested band. Absent — not null — on a manual one, because a
   *  unique index treats null as a value and two nulls would collide. */
  musicBrainzId?: string;
  country: string;
  location: string;
  status: string;
  formed: string;
  disbanded: string | null;
  genre: string[];
  disambiguation: string;
  image: string | null;
  albums: Album[];
  members: Member[];
  type: string;
  description: string;
  themes: string;
  label: string;
}

// A band as written in db.json — hand-written data, so it carries no provenance:
// the schema defaults it to "manual". "id" and "editable" are leftovers from the
// frontend's old shape; seed.ts strips them, along with "source", before inserting.
export interface BandFromJsonFile extends Partial<Band> {
  id?: string;
  editable?: boolean;
}
