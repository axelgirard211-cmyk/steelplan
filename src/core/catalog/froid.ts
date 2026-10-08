/**
 * PANNES ET LISSES FORMÉES À FROID — profils Z et C à lèvres.
 *
 * ⚠ Ce sont les sections réellement employées en couverture courante. Jusqu'ici
 * SteelPlan ne proposait que des IPE en pannes : un IPE 140 pèse 12,9 kg/m là où
 * un Z 200×2,0 en pèse 6,1 pour une portée comparable. Sur les trois cents
 * pannes d'un hangar, l'écart se compte en tonnes et en euros, et il explique à
 * lui seul pourquoi presque personne ne pose d'IPE en panne.
 *
 * ⚠⚠ CE QUE CES DIMENSIONS SONT, ET NE SONT PAS. Ce sont des dimensions
 * REPRÉSENTATIVES du marché européen, pas le catalogue d'un fabricant. Chaque
 * profileur a ses propres largeurs d'aile, ses retours et ses rayons de pliage,
 * et deux Z 200 de marques différentes ne sont pas interchangeables. Avant
 * commande, reprendre les cotes du fournisseur retenu.
 *
 * ⚠⚠⚠ Les caractéristiques ci-dessous sont celles de la section BRUTE. Une
 * section formée à froid est de classe 4 par nature : elle voile localement bien
 * avant d'atteindre sa limite d'élasticité, et sa résistance relève de
 * l'EN 1993-1-3 par les caractéristiques EFFICACES, jamais de la section brute.
 * Voir `checks/froid.ts`, qui les calcule et sans lequel ces profils seraient
 * dangereusement surestimés.
 */

/** Une famille de profils formés à froid, à une hauteur donnée. */
export interface DimensionsFroid {
  /** Hauteur hors tout (mm) : c'est elle qui donne son nom au profil. */
  readonly h: number;
  /**
   * Largeur d'aile hors tout (mm). Pour un Z, l'aile la plus large ; l'autre en
   * est déduite par `EMBOITEMENT`.
   */
  readonly b: number;
  /** Retour de lèvre hors tout (mm). */
  readonly c: number;
  /** Épaisseurs disponibles (mm). */
  readonly t: readonly number[];
}

/**
 * ⚠ Les deux ailes d'un Z sont INÉGALES, et ce n'est pas un détail de
 * fabrication : c'est ce qui permet d'emboîter deux pannes l'une dans l'autre au
 * droit d'un appui pour réaliser la continuité. Les modéliser égales ferait un
 * profil symétrique — donc un profil qu'on ne peut pas emboîter, et un produit
 * d'inertie faux.
 */
const EMBOITEMENT = 4;

/**
 * Profils en Z : pannes de toiture, les plus courants.
 *
 * ⚠ Les largeurs d'aile sont prises au MILIEU de la fourchette du marché, et
 * c'est un choix qui compte. Une première version portait des ailes plus
 * étroites de cinq à dix millimètres : les profils en ressortaient entièrement
 * efficaces, sans la moindre réduction de voilement, donc plus performants
 * qu'aucun profil réel. Une aile étroite voile moins — un catalogue trop
 * étroit flatte donc systématiquement le calcul.
 */
export const Z_DIMS: readonly DimensionsFroid[] = [
  { h: 100, b: 50, c: 15, t: [1.5, 2.0] },
  { h: 120, b: 55, c: 16, t: [1.5, 2.0, 2.5] },
  { h: 150, b: 62, c: 18, t: [1.5, 2.0, 2.5] },
  { h: 180, b: 68, c: 20, t: [1.5, 2.0, 2.5, 3.0] },
  { h: 200, b: 73, c: 20, t: [1.5, 2.0, 2.5, 3.0] },
  { h: 250, b: 80, c: 22, t: [2.0, 2.5, 3.0] },
  { h: 300, b: 90, c: 25, t: [2.0, 2.5, 3.0] },
];

/**
 * Profils en C à lèvres : lisses de bardage, pannes sur un seul appui, ossatures
 * secondaires. Symétriques, donc sans emboîtement possible.
 */
export const C_DIMS: readonly DimensionsFroid[] = [
  { h: 100, b: 50, c: 15, t: [1.5, 2.0] },
  { h: 120, b: 55, c: 16, t: [1.5, 2.0, 2.5] },
  { h: 150, b: 62, c: 18, t: [1.5, 2.0, 2.5] },
  { h: 180, b: 68, c: 20, t: [1.5, 2.0, 2.5, 3.0] },
  { h: 200, b: 73, c: 20, t: [1.5, 2.0, 2.5, 3.0] },
  { h: 250, b: 80, c: 22, t: [2.0, 2.5, 3.0] },
  { h: 300, b: 90, c: 25, t: [2.0, 2.5, 3.0] },
];

/** Largeur de la petite aile d'un Z, celle qui entre dans l'autre. */
export function petiteAile(b: number): number {
  return b - EMBOITEMENT;
}

/**
 * Rayon de pliage intérieur retenu (mm).
 *
 * ⚠ L'EN 1993-1-3 § 5.1(3) autorise à négliger l'arrondi des plis et à calculer
 * sur des angles vifs tant que r ≤ 5 t ET r ≤ 0,10 bp. Un rayon intérieur de
 * 1,5 t respecte les deux sur toute cette gamme : le modèle à angles vifs est
 * donc licite, et c'est celui que le catalogue emploie.
 *
 * Le rayon reste exposé parce qu'il est nécessaire au tracé — un pli vif dessiné
 * là où la tôle est arrondie donne une section fausse à l'œil et un développé
 * trop long au débit.
 */
export function rayonPliage(t: number): number {
  return 1.5 * t;
}

/** Désignation normalisée, ex. « Z 200x2.0 » ou « C 150x1.5 ». */
export function designationFroid(forme: 'Z' | 'C', h: number, t: number): string {
  return `${forme} ${h}x${t.toFixed(1)}`;
}
