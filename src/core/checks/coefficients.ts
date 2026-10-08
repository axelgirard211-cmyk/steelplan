/**
 * COEFFICIENTS PARTIELS DE RÉSISTANCE.
 *
 * ⚠ γM1 était défini DEUX FOIS — ici et dans le module des sections, où il était
 * resté quand γM0 en avait été sorti. Deux valeurs égales aujourd'hui, et rien
 * pour les empêcher de diverger demain. Tous les γM vivent désormais ici.
 *
 * ⚠ Isolés dans leur propre module pour une raison précise : ils sont employés
 * à la fois par la résistance de section (EN 1993-1-1) et par celle des profils
 * formés à froid (EN 1993-1-3), qui a besoin de la première pour rien d'autre.
 * Les laisser dans `section.ts` obligeait les deux modules à s'importer l'un
 * l'autre. Les recopier aurait été pire : deux γM0 dans le code, c'est la
 * garantie qu'un jour l'un des deux changera seul.
 *
 * Valeurs recommandées par l'Eurocode, reprises telles quelles par l'annexe
 * nationale française.
 */

/** Résistance des sections, quelle que soit la classe. */
export const GAMMA_M0 = 1.0;

/** Résistance des barres aux instabilités. */
export const GAMMA_M1 = 1.0;

/**
 * Résistance des assemblages : boulons, soudures, pression diamétrale.
 *
 * Distinct de γM0, et c'est voulu par l'EN 1993-1-8 : une ruine d'assemblage
 * est fragile, sans la réserve plastique d'une barre.
 */
export const GAMMA_M2 = 1.25;
