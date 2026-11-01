import type { SteelGrade, SteelGradeId } from './types';

/**
 * Nuances d'acier de construction — EN 10025-2, valeurs de l'EN 1993-1-1
 * tableau 3.1. Contraintes en N/mm².
 */
const mk = (id: SteelGradeId, fy: number, fy40: number, fu: number): SteelGrade => ({
  id,
  fy,
  fy40,
  fu,
  E: 210_000,
  G: 81_000,
  nu: 0.3,
  epsilon: Math.sqrt(235 / fy),
});

export const GRADES: Readonly<Record<SteelGradeId, SteelGrade>> = {
  S235: mk('S235', 235, 215, 360),
  S275: mk('S275', 275, 255, 430),
  S355: mk('S355', 355, 335, 510),
  /*
   * ⚠ Nuances à haute limite d'élasticité, EN 10025-3/4. Elles montent la
   * résistance de 30 % mais PAS la raideur : E reste 210 000 N/mm². Un profil en
   * S460 flèche donc exactement autant qu'en S235. Sur une traverse de portique,
   * où la flèche gouverne souvent, la nuance haute ne fait gagner que le poids
   * du métal — et coûte plus cher au kilo.
   */
  S420: mk('S420', 420, 390, 520),
  S460: mk('S460', 460, 430, 540),
};

export const GRADE_IDS: readonly SteelGradeId[] = ['S235', 'S275', 'S355', 'S420', 'S460'];

export function getGrade(id: SteelGradeId): SteelGrade {
  /*
   * ⚠ Propriété PROPRE seulement : « toString » ou « constructor » venus d'un
   * fichier remontaient sinon une fonction d'Object.prototype en guise de nuance.
   */
  if (!Object.hasOwn(GRADES, id)) throw new Error(`Nuance d’acier « ${String(id)} » inconnue.`);
  return GRADES[id];
}

/**
 * Limite d'élasticité effective selon l'épaisseur de l'élément le plus épais
 * de la section (EN 1993-1-1 §3.2.1) : au-delà de 40 mm, fy est réduite.
 */
export function fyForThickness(grade: SteelGrade, t: number): number {
  return t <= 40 ? grade.fy : grade.fy40;
}
