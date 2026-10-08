import type { Profile } from '../catalog/types';
import { sectionEfficace } from './froid';
import { GAMMA_M1, type SectionClass } from './section';

/**
 * FLAMBEMENT ET DÉVERSEMENT (EN 1993-1-1, § 6.3).
 *
 * Ce sont ces deux phénomènes qui dimensionnent réellement une charpente : un
 * poteau de 6 m ne travaille pas à sa résistance plastique, et une traverse non
 * maintenue déverse bien avant d'atteindre son moment plastique. Les ignorer
 * donnerait des profils optimistes de 30 à 50 %.
 */

const E = 210_000; // N/mm²
const G = 81_000; // N/mm², module de cisaillement

/** Courbes de flambement et leur facteur d'imperfection α. */
export type Curve = 'a0' | 'a' | 'b' | 'c' | 'd';
const ALPHA: Record<Curve, number> = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };

/**
 * Courbe de flambement d'un profil (tableau 6.2), axe fort et axe faible.
 *
 * Le rapport h/b départage les profilés en I : un profil élancé (IPE) flambe
 * mieux autour de son axe fort qu'un profil trapu (HEB), et l'axe faible est
 * toujours plus défavorable d'une courbe.
 */
export function courbes(p: Profile): { y: Curve; z: Curve } {
  if (p.shape === 'I') {
    if (p.tf > 40) return p.h / p.b > 1.2 ? { y: 'b', z: 'c' } : { y: 'd', z: 'd' };
    return p.h / p.b > 1.2 ? { y: 'a', z: 'b' } : { y: 'b', z: 'c' };
  }
  // Profils creux finis à chaud : courbe a. Les autres, courbe c.
  if (p.shape === 'CHS' || p.shape === 'BOX') return { y: 'a', z: 'a' };
  return { y: 'c', z: 'c' };
}

/**
 * Coefficient de réduction χ pour le flambement par flexion.
 *
 * `lcr` est la longueur de flambement : c'est LE paramètre que personne ne peut
 * deviner à la place de l'ingénieur, et celui où un pré-dimensionnement se
 * trompe le plus. Les valeurs retenues sont documentées à l'appel.
 */
export function chi(
  p: Profile,
  fy: number,
  inertie: number,
  lcr: number,
  courbe: Curve,
): { chi: number; lambdaBar: number; ncr: number } {
  if (lcr <= 0) return { chi: 1, lambdaBar: 0, ncr: Infinity };
  const ncr = (Math.PI ** 2 * E * inertie) / lcr ** 2;
  // Classes 1 à 3 : aire brute. Classe 4 hors domaine, traitée par l'appelant.
  const lambdaBar = Math.sqrt((p.A * fy) / ncr);
  if (lambdaBar <= 0.2) return { chi: 1, lambdaBar, ncr };

  const a = ALPHA[courbe];
  const phi = 0.5 * (1 + a * (lambdaBar - 0.2) + lambdaBar ** 2);
  const x = 1 / (phi + Math.sqrt(Math.max(0, phi ** 2 - lambdaBar ** 2)));
  return { chi: Math.min(1, x), lambdaBar, ncr };
}

/**
 * Inertie qui gouverne le flambement hors plan (mm⁴).
 *
 * ⚠ Pour une CORNIÈRE, ce n'est pas Iz : les axes principaux d'une cornière sont
 * inclinés à 45° (ailes égales), et l'inertie minimale Ieta est nettement
 * inférieure à Iz — de l'ordre de 40 % pour une L 90×90×9. Prendre Iz surestime
 * la résistance au flambement d'une diagonale de treillis, exactement là où ce
 * mode gouverne. Le catalogue fournit Ieta précisément pour cela.
 */
export function inertieFaible(p: Profile): number {
  return p.shape === 'L' ? p.Ieta : p.Iz;
}

/**
 * Le déversement concerne-t-il ce profil ?
 *
 * ⚠ La formule de Mcr retenue vaut pour les sections en I doublement
 * symétriques. L'appliquer ailleurs ne donne pas un résultat approché mais un
 * résultat faux :
 *  - une section CREUSE ou massive est trop raide en torsion pour déverser ;
 *  - une CORNIÈRE a ses axes principaux inclinés, et l'EN 1993-1-1 la traite par
 *    le flambement autour de son axe faible, non par un déversement. Lui
 *    appliquer la formule des profils en I, avec Iw = 0, donne un Mcr minuscule
 *    et des taux de travail de l'ordre de 15 sur une barre pourtant correcte.
 */
export function sujetAuDeversement(p: Profile): boolean {
  return p.shape === 'I' || p.shape === 'U';
}

/** Résistance au flambement (N). */
export function nbRd(p: Profile, fy: number, x: number): number {
  return (x * p.A * fy) / GAMMA_M1;
}

/* ------------------------------------------------------------------ */
/* Déversement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Inertie de torsion approchée (mm⁴).
 *
 * Le catalogue ne donne pas It pour les profils en I : on l'estime par la somme
 * des rectangles, majorée de 25 % pour les congés de raccordement. Recoupé sur
 * les tables : IPE 200 → 6,46 contre 6,98 cm⁴ ; IPE 300 → 19,5 contre 20,1 ;
 * IPE 400 → 46,8 contre 51,1. La sous-estimation de 3 à 8 % est du côté sûr,
 * puisqu'elle réduit Mcr et donc majore le taux de déversement.
 */
export function inertieTorsion(p: Profile): number {
  if (p.shape === 'CHS') return p.It;
  if (p.shape === 'I' || p.shape === 'U') {
    return ((2 * p.b * p.tf ** 3 + (p.h - 2 * p.tf) * p.tw ** 3) / 3) * 1.25;
  }
  if (p.shape === 'BOX') {
    // Tube fermé : formule de Bredt, section moyenne.
    const bm = p.b - p.t;
    const hm = p.h - p.t;
    return (2 * p.t * (bm * hm) ** 2) / (bm + hm);
  }
  if (p.shape === 'L') return ((p.a + p.a2) * p.t ** 3) / 3;
  if (p.shape === 'RECT') return (p.b * p.t ** 3) / 3;
  return (Math.PI * (p as { d: number }).d ** 4) / 32;
}

/**
 * Inertie de gauchissement approchée (mm⁶), profils doublement symétriques.
 *
 * Iw ≈ Iz·(h − tf)²/4 : les deux semelles vues comme deux masses écartées de
 * leur entraxe. Recoupé sur IPE 400 : 4,92·10¹¹ contre 4,90·10¹¹ mm⁶ tabulés.
 */
export function inertieGauchissement(p: Profile): number {
  if (p.shape === 'I') return (p.Iz * (p.h - p.tf) ** 2) / 4;
  return 0; // sections fermées et massives : gauchissement négligeable
}

/**
 * Moment critique de déversement élastique (N·mm).
 *
 * C1 = 1,0, c'est-à-dire moment uniforme entre maintiens : c'est la valeur
 * conservative. Un diagramme de moment réel donnerait C1 entre 1,1 et 2,6 ; s'en
 * servir demanderait de connaître la forme du diagramme sur chaque tronçon entre
 * pannes, ce qui dépasse le pré-dimensionnement.
 */
export function mcr(p: Profile, l: number, c1 = 1.0): number {
  if (l <= 0 || p.Iz <= 0) return Infinity;
  const it = inertieTorsion(p);
  const iw = inertieGauchissement(p);
  const base = (c1 * Math.PI ** 2 * E * p.Iz) / l ** 2;
  const racine = Math.sqrt(iw / p.Iz + (l ** 2 * G * it) / (Math.PI ** 2 * E * p.Iz));
  return base * racine;
}

/**
 * Coefficient de réduction χLT (§ 6.3.2.3, cas des sections laminées).
 *
 * Le palier λ̄LT,0 = 0,4 traduit le fait qu'un tronçon court ne déverse pas du
 * tout : sans lui, on pénaliserait des traverses correctement maintenues.
 */
export function chiLT(
  p: Profile,
  fy: number,
  cls: SectionClass,
  l: number,
): { chiLT: number; lambdaLT: number; mcr: number } {
  if (!sujetAuDeversement(p)) return { chiLT: 1, lambdaLT: 0, mcr: Infinity };
  const wy = cls <= 2 ? p.Wply : p.Wely;
  const mcrit = mcr(p, l);
  if (!Number.isFinite(mcrit) || mcrit <= 0) return { chiLT: 1, lambdaLT: 0, mcr: mcrit };

  const lambdaLT = Math.sqrt((wy * fy) / mcrit);
  if (lambdaLT <= 0.4) return { chiLT: 1, lambdaLT, mcr: mcrit };

  const aLT = p.shape === 'I' && p.h / p.b <= 2 ? ALPHA.b : ALPHA.c;
  const beta = 0.75;
  const phi = 0.5 * (1 + aLT * (lambdaLT - 0.4) + beta * lambdaLT ** 2);
  const x = 1 / (phi + Math.sqrt(Math.max(0, phi ** 2 - beta * lambdaLT ** 2)));
  return {
    chiLT: Math.min(1, x, 1 / lambdaLT ** 2),
    lambdaLT,
    mcr: mcrit,
  };
}

/** Moment résistant au déversement (N·mm). */
export function mbRd(p: Profile, fy: number, cls: SectionClass, xLT: number): number {
  /*
   * ⚠ Formé à froid : module EFFICACE, comme pour la résistance de section. Le
   * module élastique brut, retenu ici pour toute classe 4, donnait à la
   * vérification de stabilité une résistance que la section elle-même n'a pas.
   */
  if (p.shape === 'Z' || p.shape === 'C') return (xLT * sectionEfficace(p, fy).Weff * fy) / GAMMA_M1;
  const wy = cls <= 2 ? p.Wply : p.Wely;
  return (xLT * wy * fy) / GAMMA_M1;
}

/**
 * Coefficient de longueur de flambement dans le plan du portique.
 *
 * ⚠ Ce coefficient était FORFAITAIRE — 2,0 sur pied articulé, 1,5 sur pied
 * encastré — et le module le déclarait lui-même « l'hypothèse la plus lourde ».
 * Il l'était deux fois : trop sévère sur les portiques raides, qui n'ont pas de
 * mode déplaçable à craindre, et muet sur les portiques souples, où 2,0 ne suffit
 * pas. Le portique par défaut sort à αcr = 14,8 : il est à NŒUDS FIXES, et on lui
 * imposait une longueur de flambement double de sa hauteur.
 *
 * La classification vient maintenant du calcul (EN 1993-1-1 § 5.2.1) :
 *  - `rigide` (αcr ≥ 10) : le second ordre est négligeable ;
 *  - `souple` (3 ≤ αcr < 10) : les effets sont amplifiés par 1/(1−1/αcr).
 *
 * Dans ces deux cas, le § 5.2.2(3) autorise la longueur de flambement du mode À
 * NŒUDS FIXES, dont 1,0 × hauteur est la borne supérieure pour un poteau de
 * portique. Le forfait ancien n'est conservé que pour `instable` (αcr < 3), où
 * l'amplification n'a plus de sens et où la norme exige un calcul au second ordre
 * complet — que SteelPlan ne fait pas, et qu'il signale.
 */
export function kFlambementPlan(
  pied: 'articule' | 'encastre',
  role: string,
  classe: 'rigide' | 'souple' | 'instable' = 'instable',
): number {
  if (role !== 'poteau') {
    // Traverses et membrures : maintenues par les pannes et les portiques voisins.
    return 1.0;
  }
  if (classe === 'instable') return pied === 'encastre' ? 1.5 : 2.0;
  return 1.0;
}
