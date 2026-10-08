import { getGrade } from '../catalog/index';
import type { SteelGradeId } from '../catalog/types';
import { GAMMA_M2 } from './boulons';

/**
 * RÉSISTANCE DES CORDONS D'ANGLE — EN 1993-1-8 § 4.5.3.
 *
 * ⚠ SteelPlan émettait des cordons, les cotait sur les plans d'atelier avec leur
 * gorge, en calculait le volume déposé pour la nomenclature — et n'avait jamais
 * vérifié qu'ils tiennent. Un « a6 » porté sur un plan est une instruction de
 * soudage : il doit venir d'un calcul, pas d'une valeur d'usage.
 *
 * On retient la MÉTHODE SIMPLIFIÉE du § 4.5.3.3 : la résultante par unité de
 * longueur, quelle que soit sa direction, est comparée à fvw,d·a. Elle est
 * toujours du côté sûr par rapport à la méthode directionnelle du § 4.5.3.2, qui
 * profiterait de l'orientation du cordon — un cordon frontal résiste 22 % de plus
 * qu'un cordon latéral. Un assemblage accepté ici le serait aussi par la méthode
 * complète ; l'inverse n'est pas garanti.
 */

/**
 * Facteur de corrélation βw, EN 1993-1-8 tableau 4.1.
 *
 * ⚠ Il AUGMENTE avec la nuance, donc la résistance du cordon croît moins vite
 * que celle de l'acier assemblé. Souder du S355 ne fait pas gagner 45 % sur les
 * cordons, seulement 29 %.
 */
const BETA_W: Readonly<Record<SteelGradeId, number>> = {
  S235: 0.8,
  S275: 0.85,
  S355: 0.9,
  S420: 1.0,
  S460: 1.0,
};

/** Résistance de calcul au cisaillement du métal fondu, fvw,d (N/mm²). */
export function fvwd(nuance: SteelGradeId): number {
  const fu = getGrade(nuance).fu;
  return fu / Math.sqrt(3) / (BETA_W[nuance] * GAMMA_M2);
}

/** Effort résistant par millimètre de cordon, pour une gorge donnée (N/mm). */
export function resistanceParMm(gorge: number, nuance: SteelGradeId): number {
  return fvwd(nuance) * gorge;
}

/**
 * Gorge minimale nécessaire pour un effort donné, arrondie au millimètre
 * supérieur (mm).
 *
 * C'est la valeur qu'on porte sur le plan : « a5 », « a6 ». La donner arrondie
 * au dixième n'aurait aucun sens, un soudeur ne règle pas une gorge au dixième.
 */
export function gorgeNecessaire(
  effortParMm: number,
  nuance: SteelGradeId,
  gorgeMini = 3,
): number {
  const a = effortParMm / fvwd(nuance);
  return Math.max(gorgeMini, Math.ceil(a));
}

/**
 * Taux de travail d'un cordon sollicité par une résultante répartie.
 *
 * `effort` est la résultante TOTALE (N) reprise par `longueur` millimètres de
 * cordon de gorge `gorge`. On ne distingue pas les composantes : c'est la
 * méthode simplifiée, et sa sévérité est son intérêt.
 */
export function tauxCordon(
  effort: number,
  longueur: number,
  gorge: number,
  nuance: SteelGradeId,
): number {
  if (longueur <= 0 || gorge <= 0) return Infinity;
  return Math.abs(effort) / longueur / resistanceParMm(gorge, nuance);
}

/**
 * Gorge maximale utile sur une tôle d'épaisseur donnée.
 *
 * ⚠ Au-delà de 0,7·t, le cordon est plus résistant que la tôle qu'il assemble :
 * la matière déposée en trop ne sert à rien, coûte cher et déforme la pièce. Un
 * dimensionnement automatique qui l'ignore propose des a12 sur des platines de
 * 15 mm.
 */
export function gorgeMaxUtile(epaisseur: number): number {
  return Math.max(3, Math.floor(0.7 * epaisseur));
}
