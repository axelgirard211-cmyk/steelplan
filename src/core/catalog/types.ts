/**
 * Types du catalogue de profils normalisés européens.
 *
 * ⚠ Unités : toutes les valeurs exposées par le catalogue sont en unités
 * internes (mm, mm², mm³, mm⁴, kg/m). Les fichiers de données bruts
 * (ipe.ts, hea.ts…) sont, eux, écrits dans les unités des catalogues papier
 * (mm, cm², cm³, cm⁴, cm) pour rester vérifiables ligne à ligne face à un
 * catalogue fournisseur. La conversion a lieu une seule fois, dans index.ts.
 */

/** Familles de profils gérées. */
export type ProfileFamily =
  | 'IPE'
  | 'HEA'
  | 'HEB'
  | 'HEM'
  | 'UPN'
  | 'UPE'
  | 'L' // cornière à ailes égales
  | 'LI' // cornière à ailes inégales
  | 'CHS' // tube circulaire
  | 'SHS' // tube carré
  | 'RHS' // tube rectangulaire
  | 'PLAT' // plat / tôle
  | 'ROND' // barre ronde pleine (liernes, tirants)
  | 'Z' // panne formée à froid, profil en Z à lèvres
  | 'C'; // lisse ou panne formée à froid, profil en C à lèvres

/** Forme de la section, qui pilote le tracé du contour et l'extrusion 3D. */
export type SectionShape =
  | 'I'
  | 'U'
  | 'L'
  | 'CHS'
  | 'BOX'
  | 'RECT'
  | 'ROND'
  | 'Z'
  | 'C';

/** Caractéristiques communes à tous les profils, en unités internes. */
export interface ProfileCommon {
  /** Identifiant unique et désignation affichée, ex. « IPE 200 », « L 60x60x6 ». */
  readonly id: string;
  readonly family: ProfileFamily;
  readonly shape: SectionShape;
  /** Hauteur totale de la section (mm). */
  readonly h: number;
  /** Largeur totale de la section (mm). */
  readonly b: number;
  /** Aire de la section (mm²). */
  readonly A: number;
  /** Masse linéique (kg/m). */
  readonly G: number;
  /** Inertie de flexion axe fort (mm⁴). */
  readonly Iy: number;
  /** Inertie de flexion axe faible (mm⁴). */
  readonly Iz: number;
  /** Module élastique axe fort (mm³). */
  readonly Wely: number;
  /** Module élastique axe faible (mm³). */
  readonly Welz: number;
  /** Module plastique axe fort (mm³). */
  readonly Wply: number;
  /** Module plastique axe faible (mm³). */
  readonly Wplz: number;
  /** Rayon de giration axe fort (mm). */
  readonly iy: number;
  /** Rayon de giration axe faible (mm). */
  readonly iz: number;
  /** Périmètre développé de la section (mm) → surface à peindre / galvaniser. */
  readonly perimeter: number;
  /**
   * Provenance des caractéristiques mécaniques :
   * - `catalogue` : valeurs des tables normalisées, saisies telles quelles ;
   * - `geometrie` : calculées à partir des dimensions nominales. Exact pour les
   *   tubes et les plats (formules fermées), à quelques pourcents près pour les
   *   cornières à ailes inégales (congés de raccordement et arrondis de bord
   *   négligés : ±3 % sur l'aire et les inerties).
   */
  readonly source: 'catalogue' | 'geometrie';
}

/** Profil en I : IPE, HEA, HEB, HEM. */
export interface IProfile extends ProfileCommon {
  readonly shape: 'I';
  /** Épaisseur d'âme (mm). */
  readonly tw: number;
  /** Épaisseur de semelle (mm). */
  readonly tf: number;
  /** Rayon de raccordement âme/semelle (mm). */
  readonly r: number;
}

/** Profil en U : UPN, UPE. */
export interface UProfile extends ProfileCommon {
  readonly shape: 'U';
  readonly tw: number;
  readonly tf: number;
  readonly r: number;
  /** Position du centre de gravité selon y, depuis le dos de l'âme (mm). */
  readonly cy: number;
}

/** Cornière, ailes égales ou inégales. */
export interface LProfile extends ProfileCommon {
  readonly shape: 'L';
  /** Grande aile (mm). */
  readonly a: number;
  /** Petite aile (mm) ; égale à `a` pour une cornière à ailes égales. */
  readonly a2: number;
  /** Épaisseur (mm). */
  readonly t: number;
  /** Rayon de raccordement (mm). */
  readonly r: number;
  /**
   * Position du centre de gravité selon y, depuis le dos de la grande aile
   * (mm). La grande aile `a` est dressée selon z, son dos est le plan y = 0.
   */
  readonly cy: number;
  /**
   * Position du centre de gravité selon z, depuis le dos de la petite aile
   * (mm). La petite aile `a2` est couchée selon y, son dos est le plan z = 0.
   */
  readonly cz: number;
  /** Inertie minimale, axe principal faible (mm⁴). */
  readonly Ieta: number;
  /** Rayon de giration minimal (mm) — dimensionne le flambement des diagonales. */
  readonly imin: number;
}

/** Tube circulaire. */
export interface ChsProfile extends ProfileCommon {
  readonly shape: 'CHS';
  /** Diamètre extérieur (mm). */
  readonly d: number;
  /** Épaisseur (mm). */
  readonly t: number;
  /** Module de torsion (mm⁴). */
  readonly It: number;
}

/** Tube carré ou rectangulaire. */
export interface BoxProfile extends ProfileCommon {
  readonly shape: 'BOX';
  readonly t: number;
  /** Rayon extérieur d'angle (mm). */
  readonly ro: number;
  /** Rayon intérieur d'angle (mm). */
  readonly ri: number;
}

/** Plat ou tôle (section pleine rectangulaire). */
export interface PlateProfile extends ProfileCommon {
  readonly shape: 'RECT';
  /** Épaisseur (mm). */
  readonly t: number;
}

/**
 * Barre ronde pleine : liernes de pannes, tirants de contreventement,
 * tiges d'ancrage. Ne figure dans aucun catalogue de profilés mais est
 * indispensable dès qu'on modélise l'ossature secondaire.
 */
export interface RoundProfile extends ProfileCommon {
  readonly shape: 'ROND';
  /** Diamètre (mm). */
  readonly d: number;
}

/**
 * Profil formé à froid à lèvres : panne en Z, lisse ou panne en C.
 *
 * ⚠ Ces sections sont MINCES : l'épaisseur vaut 1,5 à 3 mm pour 100 à 300 mm de
 * hauteur. Elles ne se comportent donc pas comme un profilé laminé : elles
 * voilent localement avant de plastifier, leurs lèvres peuvent flamber par
 * distorsion, et leur résistance se calcule sur des caractéristiques EFFICACES
 * (EN 1993-1-3). Les valeurs portées ici sont celles de la section BRUTE : elles
 * donnent la masse, le dessin et la flèche, jamais la résistance.
 */
export interface ColdProfile extends ProfileCommon {
  readonly shape: 'Z' | 'C';
  /** Épaisseur de tôle (mm). */
  readonly t: number;
  /** Retour de lèvre hors tout (mm). */
  readonly c: number;
  /** Rayon de pliage intérieur (mm). */
  readonly r: number;
  /**
   * Largeurs des deux ailes (mm), grande puis petite.
   *
   * ⚠ Toutes deux STOCKÉES, jamais l'une déduite de l'autre. Sur un Z elles
   * diffèrent de l'emboîtement, et un tracé qui recalculerait la grande aile en
   * ajoutant cet écart à la petite ferait vivre la valeur à deux endroits — la
   * changer au catalogue laisserait le dessin sur l'ancienne. `b`, lui, est
   * l'encombrement TOTAL de la section : sur un Z les ailes partent en sens
   * opposés, il vaut donc près du double d'une aile.
   */
  readonly aile: number;
  readonly aile2: number;
  /**
   * Centre de gravité, mesuré depuis le DOS DE L'ÂME et depuis la fibre
   * inférieure (mm). Il ne tombe ni au milieu de la hauteur pour un Z, ni sur
   * l'âme pour un C : le tracé et les cotes en dépendent.
   */
  readonly cy: number;
  readonly cz: number;
  /**
   * Produit d'inertie central (mm⁴).
   *
   * ⚠ NON NUL pour un Z, dont les axes principaux sont inclinés sur l'âme. Une
   * panne en Z libre fléchit donc de biais. Le supposer nul — ce que ferait tout
   * calcul mené sur les seuls axes géométriques — sous-estime la flèche et
   * ignore complètement la composante latérale.
   */
  readonly Iyz: number;
  /** Inerties principales (mm⁴), section libre de toute liaison. */
  readonly Imax: number;
  readonly Imin: number;
  /** Longueur développée de la tôle à plat (mm) : ce qu'on achète au mètre. */
  readonly developpe: number;
}

/** Union discriminée de tous les profils du catalogue. */
export type Profile =
  | IProfile
  | UProfile
  | LProfile
  | ChsProfile
  | BoxProfile
  | PlateProfile
  | RoundProfile
  | ColdProfile;

/* ------------------------------------------------------------------ */
/* Nuances d'acier                                                     */
/* ------------------------------------------------------------------ */

export type SteelGradeId = 'S235' | 'S275' | 'S355' | 'S420' | 'S460';

export interface SteelGrade {
  readonly id: SteelGradeId;
  /** Limite d'élasticité fy (N/mm²) pour t ≤ 40 mm. */
  readonly fy: number;
  /** Limite d'élasticité fy (N/mm²) pour 40 < t ≤ 80 mm. */
  readonly fy40: number;
  /** Résistance à la traction fu (N/mm²) pour t ≤ 40 mm. */
  readonly fu: number;
  /** Module d'Young (N/mm²). */
  readonly E: number;
  /** Module de cisaillement (N/mm²). */
  readonly G: number;
  /** Coefficient de Poisson. */
  readonly nu: number;
  /** ε = √(235/fy), utilisé pour la classification de section. */
  readonly epsilon: number;
}

/* ------------------------------------------------------------------ */
/* Formats des tables brutes (unités catalogue papier)                 */
/* ------------------------------------------------------------------ */

/**
 * Ligne brute d'un profil en I.
 * [désignation, h(mm), b(mm), tw(mm), tf(mm), r(mm),
 *  A(cm²), G(kg/m), Iy(cm⁴), Wely(cm³), Wply(cm³), iy(cm),
 *  Iz(cm⁴), Welz(cm³), Wplz(cm³), iz(cm)]
 */
export type RawIRow = readonly [
  string, number, number, number, number, number,
  number, number, number, number, number, number,
  number, number, number, number,
];

/**
 * Ligne brute d'un profil en U.
 * [désignation, h, b, tw, tf, r, A(cm²), G, Iy(cm⁴), Wely(cm³), Wply(cm³),
 *  iy(cm), Iz(cm⁴), Welz(cm³), Wplz(cm³), iz(cm), cy(cm)]
 */
export type RawURow = readonly [
  string, number, number, number, number, number,
  number, number, number, number, number, number,
  number, number, number, number, number,
];

/**
 * Ligne brute d'une cornière.
 * [désignation, a(mm), a2(mm), t(mm), r(mm), A(cm²), G(kg/m),
 *  Iy(cm⁴), Wely(cm³), Iz(cm⁴), Welz(cm³), Ieta(cm⁴), imin(cm), cy(cm), cz(cm)]
 */
export type RawLRow = readonly [
  string, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
];
