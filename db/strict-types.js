// Rend Mongoose strict sur les types, pour TOUS les modèles.
//
// Par défaut, Mongoose est permissif : envoyer { name: 42 } enregistre le nom "42"
// sans broncher, et { genre: "punk" } devient la liste ["punk"]. Une API qui accepte
// n'importe quel type accepte aussi les fautes de frappe du frontend.
//
// cast(false) fait échouer la conversion au lieu de la deviner : Mongoose lève alors
// une ValidationError, que le gestionnaire d'erreurs central traduit en 400.
//
// Ce fichier n'exporte rien : il s'importe pour son effet. Les modèles l'importent
// en premier, avant de déclarer leur schéma.

import mongoose from "mongoose";

mongoose.Schema.Types.String.cast(false);
mongoose.Schema.Types.Number.cast(false);
mongoose.Schema.Types.Boolean.cast(false);
