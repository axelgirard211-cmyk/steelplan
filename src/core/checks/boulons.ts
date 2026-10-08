import { getGrade } from '../catalog/index';
import type { SteelGradeId } from '../catalog/types';
import { holeDiameter, type BoltClass, type BoltDiameter, type BoltSpec } from '../model/connections';

/**
 * RÉSISTANCE DES BOULONS — EN 1993-1-8 § 3.6.
 *
 * ⚠ Ce module comble le trou le plus dangereux du logiciel. SteelPlan dessinait
 * des platines, comptait les boulons, éditait des plans de fabrication complets
 * et n'avait JAMAIS vérifié qu'un boulon tienne : aucune occurrence de Fv,Rd ni
 * de Fb,Rd n'existait dans tout le code. On fabriquait sur des assemblages non
 * calculés.
 *
 * Toutes les fonctions rendent des newtons et prennent des millimètres et des
 * N/mm². Le facteur partiel des assemblages est γM2 = 1,25, distinct du γM0 des
 * sections : c'est voulu par la norme, une ruine d'assemblage étant fragile.
 */

export { GAMMA_M2 } from './coefficients';
import { GAMMA_M2 } from './coefficients';

/**
 * Aire résistante en traction As (mm²), EN ISO 898-1.
 *
 * ⚠ C'est As et non l'aire du fût qui gouverne, y compris au cisaillement dès
 * que le plan de cisaillement traverse la partie filetée — ce qu'on doit
 * supposer en charpente, la longueur de filet n'étant pas maîtrisée à la pose.
 */
const AIRE_RESISTANTE: Readonly<Record<BoltDiameter, number>> = {
  12: 84.3,
  14: 115,
  16: 157,
  20: 245,
  22: 303,
  24: 353,
  27: 459,
  30: 561,
};

/** Résistance ultime du boulon (N/mm²), EN 1993-1-8 tableau 3.1. */
const FUB: Readonly<Record<BoltClass, number>> = { '8.8': 800, '10.9': 1000 };

/**
 * Coefficient αv du cisaillement.
 *
 * ⚠ 0,60 pour la classe 8.8, mais 0,50 pour la 10.9. Le boulon le plus résistant
 * a le coefficient le plus faible : sa plus grande fragilité au cisaillement est
 * compensée par la norme. Retenir 0,6 partout surestimerait un M20 10.9 de 20 %.
 */
const ALPHA_V: Readonly<Record<BoltClass, number>> = { '8.8': 0.6, '10.9': 0.5 };

export const aireResistante = (b: BoltSpec): number => AIRE_RESISTANTE[b.d];
export const fub = (b: BoltSpec): number => FUB[b.cls];

/** Résistance au cisaillement d'UN plan de cisaillement (N). */
export function fvRd(b: BoltSpec): number {
  return (ALPHA_V[b.cls] * fub(b) * aireResistante(b)) / GAMMA_M2;
}

/** Résistance à la traction (N). k2 = 0,9 pour une tête hexagonale. */
export function ftRd(b: BoltSpec): number {
  return (0.9 * fub(b) * aireResistante(b)) / GAMMA_M2;
}

/**
 * Résistance au poinçonnement de la tôle sous la tête ou l'écrou (N).
 *
 * dm est la moyenne des diamètres sur plats et sur angles ; 1,6·d en est une
 * approximation usuelle pour les boulons HR à tête hexagonale.
 */
export function bpRd(b: BoltSpec, epaisseur: number, nuance: SteelGradeId): number {
  const dm = 1.6 * b.d;
  return (0.6 * Math.PI * dm * epaisseur * getGrade(nuance).fu) / GAMMA_M2;
}

/**
 * Résistance à la PRESSION DIAMÉTRALE de la tôle (N), EN 1993-1-8 tableau 3.4.
 *
 * ⚠ C'est très souvent elle qui gouverne, et non le boulon : une tôle de 10 mm
 * en S235 cède devant un M20 8.8 bien avant lui. C'est aussi la seule
 * vérification qui dépende des PINCES — la distance au bord et l'entraxe. Elle
 * relie donc directement le calcul au dessin : déplacer un trou change la
 * résistance de l'assemblage.
 *
 * `e1` pince dans le sens de l'effort, `p1` entraxe dans le même sens,
 * `e2` pince perpendiculaire, `p2` entraxe perpendiculaire. Passer `p1` ou `p2`
 * à 0 traite le boulon comme un boulon de RIVE, ce qui est le cas défavorable.
 */
export function fbRd(
  b: BoltSpec,
  epaisseur: number,
  nuance: SteelGradeId,
  pinces: { e1: number; p1?: number; e2: number; p2?: number },
): number {
  const d0 = holeDiameter(b);
  const fu = getGrade(nuance).fu;

  // αd : le boulon intérieur profite de son voisin, le boulon de rive non.
  const alphaD =
    pinces.p1 && pinces.p1 > 0
      ? Math.min(pinces.e1 / (3 * d0), pinces.p1 / (3 * d0) - 0.25)
      : pinces.e1 / (3 * d0);
  const alphaB = Math.max(0, Math.min(alphaD, fub(b) / fu, 1));

  const k1 =
    pinces.p2 && pinces.p2 > 0
      ? Math.min((2.8 * pinces.e2) / d0 - 1.7, (1.4 * pinces.p2) / d0 - 1.7, 2.5)
      : Math.min((2.8 * pinces.e2) / d0 - 1.7, 2.5);

  return (Math.max(0, k1) * alphaB * fu * b.d * epaisseur) / GAMMA_M2;
}

/**
 * Interaction cisaillement + traction, EN 1993-1-8 tableau 3.4.
 *
 * ⚠ Le 1,4 au dénominateur de la traction n'est pas une faveur : il traduit le
 * fait que les deux ruines ne sont pas simultanées. L'oublier — écrire une somme
 * simple — condamnerait des platines d'about parfaitement correctes, qui sont
 * précisément le cas où les deux efforts coexistent.
 */
export function interactionVT(fvEd: number, ftEd: number, b: BoltSpec, plans = 1): number {
  const v = fvEd / (plans * fvRd(b));
  const t = ftEd / (1.4 * ftRd(b));
  return v + t;
}

/** Désignation lisible d'un boulon, pour le rapport. */
export const designationBoulon = (b: BoltSpec): string => `M${b.d} ${b.cls}`;
