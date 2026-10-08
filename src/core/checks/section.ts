import type { Profile } from '../catalog/types';
import { GAMMA_M0, GAMMA_M1 } from './coefficients';
import { sectionEfficace } from './froid';

/**
 * CLASSIFICATION ET RÉSISTANCES DE SECTION (EN 1993-1-1, § 5.5 et 6.2).
 *
 * La classe de section décide de tout : une section de classe 1 ou 2 développe
 * son moment plastique, une classe 3 s'arrête à la limite élastique de sa fibre
 * extrême, une classe 4 voile localement avant même cela. Prendre Wpl sans
 * vérifier la classe, c'est surestimer la résistance de 10 à 15 % — silencieusement.
 *
 * Coefficients partiels : γM0 = γM1 = 1,0 (valeurs recommandées, reprises par
 * l'annexe nationale française).
 */

// Réexportés depuis le module des coefficients : UNE définition, pas deux.
export { GAMMA_M0, GAMMA_M1 };

export type SectionClass = 1 | 2 | 3 | 4;

export interface Classification {
  readonly cls: SectionClass;
  /** Élément qui a déclassé la section, pour que le résultat soit explicable. */
  readonly gouverne: string;
  /** Élancement de paroi constaté et limite de la classe retenue. */
  readonly rapport: number;
  readonly limite: number;
}

/** ε = √(235/fy). */
export function epsilon(fy: number): number {
  return Math.sqrt(235 / fy);
}

/**
 * Classe d'une section sous effort normal et flexion d'axe fort.
 *
 * `nEd` est l'effort normal (N), positif en TRACTION : une paroi tendue ne voile
 * pas, ce qui rend la classification plus favorable — d'où la nécessité de
 * passer le signe et non la valeur absolue.
 */
export function classer(p: Profile, fy: number, nEd = 0): Classification {
  const e = epsilon(fy);
  const pire = (a: Classification, b: Classification): Classification =>
    b.cls > a.cls ? b : a;
  let res: Classification = { cls: 1, gouverne: 'section pleine', rapport: 0, limite: 0 };

  if (p.shape === 'I' || p.shape === 'U') {
    // Semelle en console, comprimée : 9ε / 10ε / 14ε.
    const cf = p.shape === 'I' ? (p.b - p.tw - 2 * p.r) / 2 : p.b - p.tw - p.r;
    res = pire(res, seuils(cf / p.tf, [9 * e, 10 * e, 14 * e], 'semelle en console'));

    // Âme : la part comprimée dépend de l'effort normal. En flexion pure les
    // limites sont 72ε/83ε/124ε ; en compression pure 33ε/38ε/42ε. Entre les
    // deux, α situe l'axe neutre plastique.
    const cw = p.h - 2 * p.tf - 2 * p.r;
    const nComp = Math.max(0, -nEd); // seule la compression compte
    const alpha = Math.min(
      1,
      Math.max(0, 0.5 + nComp / (2 * cw * p.tw * fy)),
    );
    const l1 = alpha > 0.5 ? (396 * e) / (13 * alpha - 1) : (36 * e) / alpha;
    const l2 = alpha > 0.5 ? (456 * e) / (13 * alpha - 1) : (41.5 * e) / alpha;
    // Classe 3 : formule élastique avec ψ. On reste du côté sûr en prenant la
    // borne de compression pure quand l'effort normal domine.
    const l3 = nComp > 0 ? Math.max(42 * e, 124 * e * (1 - nComp / (cw * p.tw * fy))) : 124 * e;
    res = pire(res, seuils(cw / p.tw, [l1, l2, l3], 'âme'));
  } else if (p.shape === 'BOX') {
    // Parois internes comprimées, largeur nette des congés.
    const cz = p.h - 2 * p.t - 2 * p.ri;
    const cy = p.b - 2 * p.t - 2 * p.ri;
    res = pire(res, seuils(cz / p.t, [33 * e, 38 * e, 42 * e], 'paroi haute'));
    res = pire(res, seuils(cy / p.t, [33 * e, 38 * e, 42 * e], 'paroi large'));
  } else if (p.shape === 'CHS') {
    const e2 = e * e;
    res = pire(res, seuils(p.d / p.t, [50 * e2, 70 * e2, 90 * e2], 'tube'));
  } else if (p.shape === 'L') {
    // Cornières : classe 3 au mieux (tableau 5.2, feuille 3), jamais plastique.
    const c1 = seuils(p.a / p.t, [Infinity, Infinity, 15 * e], 'aile');
    const c2 = seuils(
      (p.a + p.a2) / (2 * p.t),
      [Infinity, Infinity, 11.5 * e],
      'ailes cumulées',
    );
    res = pire(res, c1.cls >= c2.cls ? c1 : c2);
    if (res.cls < 3) res = { ...res, cls: 3, gouverne: 'cornière (classe 3 au plus)' };
  } else if (p.shape === 'Z' || p.shape === 'C') {
    /*
     * ⚠ FORMÉ À FROID : CLASSE 4 D'OFFICE, sans passer par les élancements de
     * l'EN 1993-1-1.
     *
     * Ce n'est pas une précaution : les limites de ce tableau ne décrivent ni
     * les lèvres ni le flambement par distorsion, et un profil à lèvres ne
     * tombait dans AUCUNE de leurs branches. Il ressortait donc en classe 1,
     * « section pleine » — une tôle de 2 mm vérifiée en plastique, avec Wpl.
     *
     * Le déclarer classe 4 force tout le reste du calcul sur la voie élastique
     * et, surtout, l'empêche d'employer un module plastique que ces sections
     * n'atteignent jamais. Leur vraie résistance vient de `checks/froid.ts`, qui
     * applique l'EN 1993-1-3.
     */
    res = {
      cls: 4,
      gouverne: 'profil formé à froid (EN 1993-1-3)',
      rapport: (p.h - p.t) / p.t,
      limite: 0,
    };
  }
  // RECT et ROND : sections pleines, aucun voilement local possible.

  return res;
}

/** Classe déduite d'un élancement de paroi et des trois limites successives. */
function seuils(
  rapport: number,
  [l1, l2, l3]: [number, number, number],
  gouverne: string,
): Classification {
  if (rapport <= l1) return { cls: 1, gouverne, rapport, limite: l1 };
  if (rapport <= l2) return { cls: 2, gouverne, rapport, limite: l2 };
  if (rapport <= l3) return { cls: 3, gouverne, rapport, limite: l3 };
  return { cls: 4, gouverne, rapport, limite: l3 };
}

/* ------------------------------------------------------------------ */
/* Résistances                                                         */
/* ------------------------------------------------------------------ */

/** Résistance plastique en traction ou compression (N). */
export function nRd(p: Profile, fy: number): number {
  return (p.A * fy) / GAMMA_M0;
}

/**
 * Moment résistant d'axe fort (N·mm).
 *
 * Plastique en classe 1 et 2, élastique en classe 3.
 *
 * ⚠ Pour un profil FORMÉ À FROID, le module élastique brut surestimerait la
 * résistance : la matière qui a voilé ne porte plus. On passe donc par le module
 * EFFICACE de l'EN 1993-1-3, calculé paroi par paroi. C'est le seul chemin par
 * lequel ces profils reçoivent une résistance juste — le laisser tomber sur
 * `Wely` ferait entrer les pannes Z dans le calcul avec 10 à 15 % de trop.
 *
 * ⚠ L'aile comprimée retenue est la HAUTE, cas de la charge descendante. Sous
 * soulèvement c'est l'autre, et sur un Z elles n'ont pas la même largeur ; la
 * différence reste sous le pour-cent sur ce catalogue. Sous soulèvement, c'est
 * la STABILITÉ de cette semelle libre qui gouverne, bien avant la section :
 * elle est vérifiée à part, avec l'aile basse (`semelleLibre`).
 */
export function mcRd(p: Profile, fy: number, cls: SectionClass): number {
  if (p.shape === 'Z' || p.shape === 'C') return sectionEfficace(p, fy).McRd;
  const w = cls <= 2 ? p.Wply : p.Wely;
  return (w * fy) / GAMMA_M0;
}

/** Moment résistant d'axe faible (N·mm). */
export function mczRd(p: Profile, fy: number, cls: SectionClass): number {
  const w = cls <= 2 ? p.Wplz : p.Welz;
  return (w * fy) / GAMMA_M0;
}

/**
 * Aire de cisaillement (mm²), effort parallèle à l'âme.
 *
 * Pour un profilé en I laminé : A − 2·b·tf + (tw + 2r)·tf, sans descendre sous
 * η·hw·tw. On prend η = 1,0, ce qui est la valeur sûre.
 */
export function aireCisaillement(p: Profile): number {
  if (p.shape === 'I') {
    const av = p.A - 2 * p.b * p.tf + (p.tw + 2 * p.r) * p.tf;
    return Math.max(av, (p.h - 2 * p.tf) * p.tw);
  }
  if (p.shape === 'U') return p.A - 2 * p.b * p.tf + (p.tw + p.r) * p.tf;
  if (p.shape === 'BOX') return (p.A * p.h) / (p.b + p.h);
  if (p.shape === 'CHS') return (2 * p.A) / Math.PI;
  if (p.shape === 'L') return p.a * p.t;
  return p.A;
}

/** Résistance plastique au cisaillement (N). */
export function vplRd(p: Profile, fy: number): number {
  return (aireCisaillement(p) * (fy / Math.sqrt(3))) / GAMMA_M0;
}

/**
 * Moment résistant réduit par l'effort normal (N·mm), classes 1 et 2.
 *
 * Formule des profilés en I fléchis d'axe fort (§ 6.2.9.1) : la réduction ne
 * s'applique qu'au-delà de deux seuils, en dessous desquels l'âme suffit à
 * reprendre l'effort normal sans entamer le moment.
 */
export function mnRd(p: Profile, fy: number, cls: SectionClass, nEd: number): number {
  const mpl = mcRd(p, fy, cls);
  if (cls > 2 || p.shape !== 'I') return mpl;

  const npl = nRd(p, fy);
  const n = Math.abs(nEd) / npl;
  const aireAme = (p.h - 2 * p.tf) * p.tw;
  if (n <= 0.25 && Math.abs(nEd) <= (0.5 * aireAme * fy) / GAMMA_M0) return mpl;

  const a = Math.min(0.5, (p.A - 2 * p.b * p.tf) / p.A);
  return Math.min(mpl, (mpl * (1 - n)) / (1 - 0.5 * a));
}

/**
 * Réduction de la limite d'élasticité par le cisaillement (§ 6.2.8).
 *
 * En dessous de la moitié de la résistance plastique au cisaillement, l'effort
 * tranchant est sans effet sur le moment. Au-delà, il faut affaiblir l'âme.
 * Renvoie le facteur (1 − ρ) à appliquer.
 */
export function reductionCisaillement(vEd: number, vpl: number): number {
  if (vpl <= 0) return 1;
  const ratio = Math.abs(vEd) / vpl;
  if (ratio <= 0.5) return 1;
  const rho = (2 * ratio - 1) ** 2;
  return Math.max(0, 1 - rho);
}
