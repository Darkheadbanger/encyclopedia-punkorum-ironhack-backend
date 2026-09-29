// Les types d'un groupe de punk. Le schéma Mongoose (models/Band.model.ts) s'appuie
// sur ces interfaces : si un champ change ici, tsc signale le schéma qui ne suit pas.

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

export interface Band {
  name: string;
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

// Un groupe tel qu'il est écrit dans db.json. "id", "source" et "editable"
// appartiennent au frontend ; seed.ts les retire avant l'insertion.
export interface BandFromJsonFile extends Partial<Band> {
  id?: string;
  source?: string;
  editable?: boolean;
}
