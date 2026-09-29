// Le modèle Band : un groupe de punk dans l'encyclopédie.
//
// La validation vit maintenant DANS le schéma (required, maxlength, match...).
// C'est la grande différence avec l'ancienne fonction validateBand() : Mongoose
// refuse d'écrire un document invalide, même si une route oublie de vérifier.
// La route n'a plus qu'à traduire l'erreur de Mongoose en réponse HTTP 400.

import mongoose from "mongoose";
import "../db/strict-types.ts"; // refuse { name: 42 } au lieu de le convertir en "42"
import type { Album, Band, Member } from "../types/index.ts";

const MAX_NAME = 200;
const MAX_TEXT = 500;
const MAX_LIST = 100;
const MAX_DESCRIPTION = 20000;

// Une année plausible : 4 chiffres, entre 1900 et l'an prochain.
const anneeValide = {
  validator: (valeur: string | null | undefined) => {
    if (valeur == null || valeur === "") return true; // le champ est optionnel
    if (!/^\d{4}$/.test(valeur)) return false;
    return Number(valeur) >= 1900 && Number(valeur) <= new Date().getFullYear() + 1;
  },
  message: (props: { value: unknown }) => `"${props.value}" n'est pas une année plausible (1900-${new Date().getFullYear() + 1}).`,
};

const listeCourte = {
  validator: (liste: unknown[] | undefined) => !liste || liste.length <= MAX_LIST,
  message: `Une liste ne peut pas dépasser ${MAX_LIST} entrées.`,
};

// Les albums et les membres sont IMBRIQUÉS dans le groupe, pas dans leur propre
// collection : on ne les consulte jamais sans leur groupe. C'est exactement le cas
// où le modèle document de Mongo est plus simple qu'une table séparée.
const albumSchema = new mongoose.Schema<Album>({
  title: { type: String, required: true, trim: true, maxlength: MAX_TEXT },
  year: { type: String, trim: true, validate: anneeValide },
  type: { type: String, trim: true, maxlength: MAX_TEXT },
}, { _id: false });

const memberSchema = new mongoose.Schema<Member>({
  name: { type: String, required: true, trim: true, maxlength: MAX_TEXT },
  instrument: { type: String, trim: true, maxlength: MAX_TEXT },
  period: { type: String, trim: true, maxlength: MAX_TEXT },
  otherBands: { type: [String], default: undefined, validate: listeCourte },
}, { _id: false });

const bandSchema = new mongoose.Schema<Band>({
  name: {
    type: String,
    required: [true, "Un groupe a besoin d'un nom."],
    trim: true,
    maxlength: [MAX_NAME, `Le nom doit faire moins de ${MAX_NAME} caractères.`],
  },
  country: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  location: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  status: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  formed: { type: String, trim: true, validate: anneeValide, default: "" },
  disbanded: { type: String, trim: true, validate: anneeValide, default: null },
  genre: { type: [String], default: [], validate: listeCourte },
  disambiguation: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  image: { type: String, trim: true, default: null },
  albums: { type: [albumSchema], default: [], validate: listeCourte },
  members: { type: [memberSchema], default: [], validate: listeCourte },
  type: { type: String, trim: true, maxlength: MAX_TEXT, default: "Group" },
  description: { type: String, trim: true, maxlength: MAX_DESCRIPTION, default: "" },
  themes: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
  label: { type: String, trim: true, maxlength: MAX_TEXT, default: "" },
}, {
  timestamps: true, // ajoute createdAt et updatedAt automatiquement

  // Mongo nomme sa clé "_id" et ajoute "__v". Le frontend, lui, attend "id".
  // Cette transformation fait la traduction à la sortie, ce qui évite de toucher
  // une seule ligne de React.
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (document, { _id, ...objet }) => ({ id: _id.toString(), ...objet }),
  },
});

export default mongoose.model<Band>("Band", bandSchema);
