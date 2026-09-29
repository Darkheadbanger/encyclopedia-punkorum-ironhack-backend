// Le modèle User : un compte qui peut se connecter à l'encyclopédie.
//
// Le mot de passe n'est JAMAIS stocké en clair : la route de signup le hache avec
// bcrypt avant de créer le document. Le minlength ci-dessous s'applique donc au
// hash (toujours 60 caractères) ; c'est la route qui vérifie les 8 caractères du
// mot de passe tapé par l'utilisateur, avant de le hacher.

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import "../db/strict-types.ts"; // refuse { email: 42 } au lieu de le convertir en "42"
import type { User } from "../types/index.ts";

const MIN_PASSWORD = 8;
const SALT_ROUNDS = 10;

// Volontairement simple : quelque chose@quelque chose.extension, sans espace.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema<User>({
  email: {
    type: String,
    required: [true, "L'email est requis."],
    unique: true, // crée un index unique dans Mongo : deux comptes ne partagent pas un email
    lowercase: true,
    trim: true,
    match: [EMAIL_REGEX, "Cet email n'est pas valide."],
  },
  password: {
    type: String,
    required: [true, "Le mot de passe est requis."],
    minlength: [MIN_PASSWORD, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`],
  },
  username: {
    type: String,
    required: [true, "Le nom d'utilisateur est requis."],
    trim: true,
  },
}, {
  timestamps: true, // ajoute createdAt et updatedAt automatiquement

  // Même traduction que Band (_id -> id), et surtout : le hash du mot de passe
  // ne sort jamais dans une réponse JSON, même si une route oublie de le retirer.
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (document, { _id, password, ...objet }) => ({ id: _id.toString(), ...objet }),
  },
});

// Le hachage vit ici, pas dans la route : aucun chemin de code ne peut écrire un
// mot de passe en clair, même un script ou un seed qui oublierait de le faire.
//
// Mongoose valide AVANT d'exécuter ce hook, donc le minlength du schéma porte bien
// sur le mot de passe tapé, pas sur le hash.
// Un hook async ne reçoit pas de callback `next` : il suffit de retourner.
userSchema.pre("save", async function hashPassword() {
  // Sans ce test, changer son email re-hacherait un hash déjà haché.
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  this.password = await bcrypt.hash(this.password, salt);
});

export default mongoose.model<User>("User", userSchema);
