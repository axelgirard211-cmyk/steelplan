/**
 * Plats et tôles — section pleine rectangulaire.
 *
 * Un plat est entièrement défini par sa largeur et son épaisseur : la liste
 * ci-dessous n'est qu'un choix courant proposé à la saisie, `createPlate`
 * permet de fabriquer n'importe quelle dimension (platines d'about, goussets,
 * éclisses… dont les dimensions sortent d'un calcul, pas d'un catalogue).
 */

/** Largeurs de plats laminés courantes (mm). */
export const PLAT_WIDTHS: readonly number[] = [
  20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 150, 180, 200, 250, 300,
];

/** Épaisseurs de tôles courantes (mm). */
export const PLAT_THICKNESSES: readonly number[] = [
  4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40,
];

/**
 * Couples (largeur, épaisseur) proposés par défaut dans le catalogue.
 * On ne génère pas le produit cartésien complet (198 entrées inutiles) mais
 * les combinaisons réellement laminées : épaisseur ≤ largeur / 4.
 */
export const PLAT_DIMS: readonly (readonly [number, number])[] = PLAT_WIDTHS.flatMap(
  (w) => PLAT_THICKNESSES.filter((t) => t <= w / 4).map((t) => [w, t] as const),
);
