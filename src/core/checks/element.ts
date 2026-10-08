import { fyForThickness, getGrade, getProfile } from '../catalog/index';
import type { Profile, SteelGradeId } from '../catalog/types';
import type { MemberRole } from '../geometry/member';
import { chi, chiLT, courbes, inertieFaible, mbRd, nbRd } from './buckling';
import { elancement } from './elancement';
import {
  GAMMA_M0,
  classer,
  mcRd,
  mczRd,
  mnRd,
  nRd,
  reductionCisaillement,
  vplRd,
  type SectionClass,
} from './section';
import type { Ratios } from './types';

/**
 * VÉRIFICATION D'UN ÉLÉMENT sous un jeu de sollicitations donné.
 *
 * Cœur commun à tous les éléments, portique comme ossature secondaire : ce qui
 * change d'un rôle à l'autre, ce sont les sollicitations et les longueurs de
 * flambement — pas les formules. Les factoriser ici garantit qu'une panne et une
 * traverse sont vérifiées avec la même rigueur.
 *
 * Unités d'entrée : N et N·mm. Les taux sont sans dimension.
 */

export interface Sollicitations {
  /** Effort normal (N), positif en traction. */
  readonly nEd: number;
  /** Moment d'axe fort (N·mm). */
  readonly myEd: number;
  /** Moment d'axe faible (N·mm), pannes et lisses fléchies dans les deux plans. */
  readonly mzEd: number;
  readonly vEd: number;
}

export interface LongueursFlambement {
  /** Dans le plan de l'âme (axe fort). */
  readonly lcrY: number;
  /** Hors plan (axe faible) : distance entre maintiens latéraux. */
  readonly lcrZ: number;
  /** Longueur de déversement : distance entre maintiens de la semelle comprimée. */
  readonly lLT: number;
}

export interface ElementCheck {
  readonly cls: SectionClass;
  readonly ratios: Ratios;
  /** Élancement constaté et limite retenue : le rapport les affiche tous deux. */
  readonly elancement: { readonly valeur: number; readonly limite: number };
  readonly avertissements: readonly string[];
}

/** Limite d'élasticité tenant compte de l'épaisseur de la paroi la plus épaisse. */
export function fyDe(p: Profile, grade: SteelGradeId): number {
  /*
   * ⚠ Épaisseur de la paroi la plus épaisse : c'est elle qui fixe fy. Un profil
   * formé à froid, absent de ces branches, retombait sur la HAUTEUR — 200 mm
   * pour une tôle de 2 — et recevait la limite réduite d'une tôle épaisse :
   * 215 MPa au lieu de 235 en S235, sur tous les Z et C du catalogue. Seule la
   * barre ronde pleine prend légitimement son diamètre.
   */
  const t =
    p.shape === 'I' || p.shape === 'U'
      ? Math.max(p.tw, p.tf)
      : p.shape === 'L' ||
          p.shape === 'CHS' ||
          p.shape === 'BOX' ||
          p.shape === 'RECT' ||
          p.shape === 'Z' ||
          p.shape === 'C'
        ? p.t
        : p.h;
  return fyForThickness(getGrade(grade), t);
}

export function verifierElement(
  profileId: string,
  grade: SteelGradeId,
  role: MemberRole,
  s: Sollicitations,
  l: LongueursFlambement,
  flecheRatio = 0,
): ElementCheck {
  const p = getProfile(profileId);
  const fy = fyDe(p, grade);
  const c = classer(p, fy, s.nEd);
  const avertissements: string[] = [];
  /*
   * ⚠ PAS pour un profil formé à froid. Ce message vaut pour un LAMINÉ de classe
   * 4, dont SteelPlan ne calcule pas la section efficace. Pour un Z ou un C, il
   * disait le contraire du vrai — le voilement local est précisément ce que la
   * section efficace de l'EN 1993-1-3 prend en compte — et affichait un
   * « 99,0 > 0,0 » dénué de sens, la classification de ces profils n'ayant pas
   * de limite d'élancement.
   */
  const froid = p.shape === 'Z' || p.shape === 'C';
  if (c.cls === 4 && !froid) {
    avertissements.push(
      `Section de classe 4 (${c.gouverne} : ${c.rapport.toFixed(1)} > ${c.limite.toFixed(1)}) : ` +
        'le voilement local n’est pas couvert, résultat indicatif uniquement.',
    );
  }

  /* --- Cisaillement, et son effet sur le moment --- */
  const vpl = vplRd(p, fy);
  const ratioV = vpl > 0 ? Math.abs(s.vEd) / vpl : 0;
  const reduc = reductionCisaillement(s.vEd, vpl);
  if (reduc < 1) {
    avertissements.push(
      `Effort tranchant supérieur à la moitié de la résistance plastique : ` +
        `limite d’élasticité réduite de ${((1 - reduc) * 100).toFixed(0)} % dans l’âme.`,
    );
  }
  const fyRed = fy * reduc;

  /* --- Résistance de section : interaction N + M --- */
  let ratioSection: number;
  if (c.cls <= 2) {
    const mn = mnRd(p, fyRed, c.cls, s.nEd);
    const mz = mczRd(p, fyRed, c.cls);
    ratioSection =
      (mn > 0 ? Math.abs(s.myEd) / mn : 0) + (mz > 0 ? Math.abs(s.mzEd) / mz : 0);
    // Effort normal seul, sans moment : la formule ci-dessus le masquerait.
    ratioSection = Math.max(ratioSection, Math.abs(s.nEd) / nRd(p, fyRed));
  } else {
    // Classes 3 et 4 : sommation élastique des contraintes.
    const my = mcRd(p, fyRed, 3);
    const mz = mczRd(p, fyRed, 3);
    ratioSection =
      Math.abs(s.nEd) / nRd(p, fyRed) +
      (my > 0 ? Math.abs(s.myEd) / my : 0) +
      (mz > 0 ? Math.abs(s.mzEd) / mz : 0);
  }

  /* --- Flambement et déversement --- */
  const comprime = s.nEd < 0;
  const cu = courbes(p);
  const xy = chi(p, fy, p.Iy, l.lcrY, cu.y);
  const xz = chi(p, fy, inertieFaible(p), l.lcrZ, cu.z);
  const xMin = Math.min(xy.chi, xz.chi);
  const nb = nbRd(p, fy, xMin);

  /**
   * ⚠ Le déversement ne s'applique qu'à une barre COMPRIMÉE ou FLÉCHIE SEULE.
   * Un effort normal de traction stabilise la semelle comprimée par la flexion :
   * une barre tendue ne déverse pas. La vérifier au déversement quand même
   * conduisait à des taux de travail supérieurs à 15 sur les membrures
   * inférieures de treillis, qui sont précisément des tirants — et à condamner un
   * dimensionnement correct.
   */
  const lt = comprime || Math.abs(s.nEd) < 1e-9 ? chiLT(p, fy, c.cls, l.lLT) : null;
  const mb = lt ? mbRd(p, fy, c.cls, lt.chiLT) : 0;

  /**
   * Interaction flambement + déversement, forme linéaire simplifiée.
   *
   * ⚠ L'EN 1993-1-1 § 6.3.3 utilise des facteurs d'interaction kyy, kyz qui
   * dépendent de la forme du diagramme de moment. La somme linéaire retenue ici
   * est PLUS SÉVÈRE que 6.3.3 dans la quasi-totalité des cas : un élément
   * accepté par SteelPlan le serait aussi par le calcul complet, l'inverse
   * n'étant pas garanti. C'est le sens acceptable de l'approximation.
   */
  const ratioFlambement = comprime && nb > 0 ? Math.abs(s.nEd) / nb : 0;
  const ratioStabilite =
    mb > 0 ? Math.abs(s.myEd) / mb + ratioFlambement : ratioFlambement;

  if (xz.lambdaBar > 3) {
    avertissements.push(
      `Élancement hors plan λ̄ = ${xz.lambdaBar.toFixed(1)} : élément très élancé, ` +
        'maintiens latéraux à revoir.',
    );
  }

  /*
   * ⚠ L'élancement est contrôlé sur TOUTE barre, tendue comprise. C'est
   * justement sur les barres tendues qu'il compte : elles n'ont aucun autre
   * critère qui les empêche de devenir des fils de fer.
   */
  const el = elancement(p, role, l.lcrY, l.lcrZ);
  if (el.ratio > 1) {
    avertissements.push(
      `Élancement λ = ${el.lambda.toFixed(0)} au-delà de la limite de bonne pratique ` +
        `(${el.limite}) : barre trop fine pour être montée et tenue droite.`,
    );
  }

  return {
    cls: c.cls,
    ratios: {
      section: ratioSection,
      cisaillement: ratioV,
      flambement: ratioFlambement,
      stabilite: ratioStabilite,
      fleche: flecheRatio,
      elancement: el.ratio,
    },
    elancement: { valeur: el.lambda, limite: el.limite },
    avertissements,
  };
}

/**
 * Longueur de déversement d'un rôle donné, déduite de l'ossature réellement
 * construite.
 *
 * ⚠ Hypothèse à connaître : on suppose la semelle COMPRIMÉE maintenue par les
 * pannes ou les lisses. C'est vrai en travée sous charge descendante ; c'est faux
 * au voisinage du jarret et sous soulèvement, où c'est la semelle inférieure qui
 * est comprimée et que rien ne tient. Un bracon y est nécessaire — le rapport le
 * rappelle.
 */
export function longueurMaintien(
  role: MemberRole,
  longueur: number,
  entraxePannes: number,
  entraxeLisses: number,
  maille = longueur,
): number {
  // La console porte des pannes comme la traverse qu'elle prolonge.
  if (role === 'traverse' || role === 'console') {
    return entraxePannes > 0 ? Math.min(entraxePannes, longueur) : longueur;
  }
  if (role === 'poteau') {
    return entraxeLisses > 0 ? Math.min(entraxeLisses, longueur) : longueur;
  }
  if (ROLES_TREILLIS.includes(role)) {
    // Barres de treillis : la maille, c'est-à-dire la distance entre nœuds.
    // Voir la mise en garde de `longueurMaille` ci-dessous.
    return maille;
  }
  return longueur;
}

/** Barres qui appartiennent à un treillis et flambent d'un nœud à l'autre. */
const ROLES_TREILLIS: readonly MemberRole[] = [
  'membrure-sup',
  'membrure-inf',
  'montant',
  'diagonale',
];

/**
 * Longueur de flambement DANS LE PLAN.
 *
 * ⚠ Pour une barre de treillis, c'est la maille et non la longueur de la barre :
 * une membrure inférieure d'un seul tenant sur 18 m est reliée aux diagonales
 * tous les 2,25 m, et flambe donc sur 2,25 m. Retenir 18 m donnait un taux de
 * travail de 33 sur une cornière parfaitement correcte.
 *
 * Hors plan, la même maille est retenue, ce qui suppose la ferme intégrée à une
 * toiture contreventée. Sous SOULÈVEMENT la membrure inférieure passe en
 * compression : il faut alors une lierne de stabilité pour que cette hypothèse
 * tienne. SteelPlan ne la construit pas — le rapport le signale.
 */
export function longueurMaille(
  role: MemberRole,
  longueur: number,
  maille: number,
  kPortique: number,
): number {
  return ROLES_TREILLIS.includes(role) ? maille : kPortique * longueur;
}

export { GAMMA_M0 };
