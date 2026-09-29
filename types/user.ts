// Les types d'un compte utilisateur.

export interface User {
  email: string;
  password: string; // toujours le hash bcrypt, jamais le mot de passe en clair
  username: string;
}

// Ce qu'un client a le droit de voir d'un compte : tout sauf le mot de passe.
export type PublicUser = Omit<User, "password"> & { id: string };

// Ce que le JWT transporte. Un JWT n'est pas chiffré : n'importe qui peut lire
// son contenu. Donc rien de sensible ici, jamais le mot de passe.
export interface TokenPayload {
  id: string;
  email: string;
  username: string;
}
