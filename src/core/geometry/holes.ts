import type { BoltSpec } from '../model/connections';
import { holeDiameter } from '../model/connections';
import type { Pt2 } from './section';

/**
 * Perçages.
 *
 * ⚠ Un trou n'est JAMAIS décrit par des coordonnées absolues dans l'espace : il
 * est repéré dans le système de la pièce — abscisse le long de l'axe depuis
 * l'about d'origine, et position (y, z) dans la section. C'est exactement ainsi
 * qu'un débiteur perce, et c'est ainsi que ce sera coté sur le plan de débit.
 *
 * Corollaire : la même platine posée sur deux pièces différentes engendre deux
 * jeux de trous cohérents entre eux par construction, puisqu'ils sont déduits du
 * même modèle d'assemblage.
 */

/** Élément de la section traversé par le perçage. */
export type DrilledPart = 'semelle-sup' | 'semelle-inf' | 'ame' | 'aile' | 'plat';

export interface Hole {
  /** Abscisse le long de l'axe depuis l'about d'origine de la pièce (mm). */
  readonly s: number;
  /** Position dans la section (mm), repère local y = largeur, z = hauteur. */
  readonly at: Pt2;
  /** Diamètre de perçage (mm), jeu compris. */
  readonly d: number;
  /**
   * Direction de perçage : `y` pour un trou traversant la section de part en
   * part selon la largeur (âme), `z` selon la hauteur (semelle).
   */
  readonly through: 'y' | 'z';
  readonly part: DrilledPart;
  /** Repère de l'assemblage dont ce trou provient, pour la traçabilité. */
  readonly from: string;
}

/**
 * Provenance d'un trou EN ATTENTE : percé, mais qui ne reçoit pas de boulon.
 *
 * On perce ainsi une pièce standard à l'identique partout où elle sert, même là
 * où une partie de ses trous reste inutile : une échantignolle de pignon ne
 * porte qu'une panne, mais percée comme les autres, elle garde leur repère — et
 * ses traverses avec elle.
 */
export const EN_ATTENTE = 'en attente';

/** Fabrique un perçage à partir d'une spécification de boulon. */
export function hole(
  s: number,
  at: Pt2,
  bolt: BoltSpec,
  through: 'y' | 'z',
  part: DrilledPart,
  from: string,
): Hole {
  return { s, at, d: holeDiameter(bolt), through, part, from };
}

/**
 * Grille de boulons d'une platine : `rows` rangées suivant la hauteur, `cols`
 * files suivant la largeur, centrée sur l'origine.
 *
 * Les rangées sont réparties symétriquement autour du centre avec l'entraxe
 * `pitch` ; les files sont écartées de `gauge`.
 */
export function boltGrid(rows: number, cols: number, pitch: number, gauge: number): Pt2[] {
  const out: Pt2[] = [];
  for (let i = 0; i < rows; i++) {
    const z = (i - (rows - 1) / 2) * pitch;
    for (let j = 0; j < cols; j++) {
      const y = (j - (cols - 1) / 2) * gauge;
      out.push({ y, z });
    }
  }
  return out;
}

/**
 * Semelles du profil soudé derrière une platine d'about verticale, en distances
 * depuis le HAUT de sa hauteur utile (mm) : celles de la traverse, coupée
 * d'aplomb sous une pente de cosinus `cosA`, et celle du jarret s'il y en a un.
 */
export function semellesDerrierePlatine(
  h: number,
  tf: number,
  cosA: number,
  hauteurUtile: number,
): [number, number][] {
  const hv = h / cosA;
  const e = tf / cosA;
  const out: [number, number][] = [
    [0, e],
    [hv - e, hv],
  ];
  // Un jarret prolonge l'assemblage sous la traverse : sa semelle en ferme le bas.
  if (hauteurUtile > hv + e) out.push([hauteurUtile - tf, hauteurUtile]);
  return out;
}

/**
 * Grille d'une platine d'about : les rangées réparties entre les deux pinces,
 * puis ÉCARTÉES DES SEMELLES du profil soudé derrière elle.
 *
 * ⚠ Réparties sans regarder ce qu'il y a derrière, une rangée tombait dans la
 * semelle basse de la traverse dès que la platine se prolongeait sur un jarret :
 * la tête du boulon s'y logeait à moitié. Une rangée qui tombe dans une semelle,
 * ou trop près pour la clé, saute au-dessus ou au-dessous, au plus près, sans
 * jamais se rapprocher de ses voisines à moins de 2,2 d0.
 *
 * C'est la SEULE écriture : la platine, le perçage du porteur et le calcul de
 * l'assemblage la lisent tous ici.
 */
export function grilleDePlatine(o: {
  readonly hauteurUtile: number;
  readonly rows: number;
  readonly cols: number;
  readonly edgeDistance: number;
  readonly gauge: number;
  readonly bolt: BoltSpec;
  readonly semelles?: readonly (readonly [number, number])[];
}): Pt2[] {
  const H = o.hauteurUtile;
  const pas = pitchFor(H, o.rows, o.edgeDistance);
  const cle = (0.75 * o.bolt.d) / Math.cos(Math.PI / 6) + 2;
  const pasMini = 2.2 * holeDiameter(o.bolt);
  const interdits = (o.semelles ?? []).map(([a, b]) => [a - cle, b + cle] as const);
  const dans = (d: number): (readonly [number, number]) | undefined => interdits.find(([a, b]) => d > a && d < b);
  const rangees: number[] = [];
  for (let i = 0; i < o.rows; i++) {
    const voulu = o.edgeDistance + i * pas;
    const mini = i > 0 ? (rangees[i - 1] as number) + pasMini : o.edgeDistance;
    let d = Math.max(voulu, mini);
    for (let k = 0; k < 4; k++) {
      const bande = dans(d);
      if (!bande) break;
      const dessus = bande[0];
      d = dessus >= mini && voulu - dessus <= bande[1] - voulu ? dessus : bande[1];
    }
    rangees.push(d);
  }
  const out: Pt2[] = [];
  for (const d of rangees) {
    for (let j = 0; j < o.cols; j++) out.push({ y: (j - (o.cols - 1) / 2) * o.gauge, z: H / 2 - d });
  }
  return out;
}

/**
 * Entraxe des rangées d'une platine dont la hauteur utile est imposée :
 * on répartit `rows` rangées entre les deux pinces.
 */
export function pitchFor(hauteurUtile: number, rows: number, edgeDistance: number): number {
  if (rows < 2) return 0;
  return (hauteurUtile - 2 * edgeDistance) / (rows - 1);
}

/**
 * Signature d'un jeu de perçages, pour le repérage.
 *
 * ⚠ Elle doit être invariante par les MOUVEMENTS RÉELS de la pièce, sinon deux
 * pièces identiques recevraient deux repères. Concrètement : sur une section
 * doublement symétrique (I, tube, plat, rond), retourner la barre d'un demi-tour
 * autour de son axe donne la même pièce, ce qui envoie (y, z) sur (−y, −z). Un
 * poteau percé sur sa semelle intérieure gauche et son symétrique percé sur sa
 * semelle intérieure droite sont donc bien une seule et même pièce.
 *
 * On ne va pas plus loin : le retournement bout pour bout n'est PAS considéré
 * comme équivalent, car il n'est licite que si les deux abouts sont identiques,
 * ce que la présence de perçages rend rarement vrai.
 */
export function holeSignature(
  holes: readonly Hole[],
  options: { readonly demiTourAutourDeLAxe: boolean } = { demiTourAutourDeLAxe: false },
): string {
  const brut = clef(holes, 1);
  if (!options.demiTourAutourDeLAxe) return brut;
  const tourne = clef(holes, -1);
  // On retient la plus petite des deux : deux orientations d'une même pièce
  // aboutissent ainsi à la même signature.
  return brut < tourne ? brut : tourne;
}

function clef(holes: readonly Hole[], signe: 1 | -1): string {
  return [...holes]
    .map(
      (h) =>
        `${Math.round(h.s)}:${Math.round(signe * h.at.y)}:${Math.round(signe * h.at.z)}:${h.d}${h.through}`,
    )
    .sort()
    .join(',');
}

/**
 * Trou OBLONG d'une tôle : allongé selon l'un des axes de son repère.
 *
 * Il laisse coulisser le boulon — une tête de potelet suit la flèche de la
 * traverse sans la porter. `longueur` est la longueur hors tout du trou, jeu
 * compris : un oblong 18 × 68 laisse ±25 mm de course à un M16.
 */
export interface Oblong {
  readonly longueur: number;
  readonly sens: 'y' | 'z';
}

/** Trou de tôle, rond ou oblong — la forme commune à toutes ses lectures. */
interface TrouDeTole {
  readonly at: Pt2;
  readonly d: number;
  readonly oblong?: Oblong;
}

/**
 * Contour d'un trou dans le plan de sa tôle, parcouru en sens horaire.
 *
 * ⚠ La SEULE description de la forme d'un trou : la 3D, la découpe DXF et les
 * vues de tôle la lisent toutes. Un oblong dessiné rond sur l'une d'elles
 * partirait percé rond — et la tête de potelet bloquerait la traverse.
 */
export function contourDeTrou(h: TrouDeTole, segments = 24): Pt2[] {
  const r = h.d / 2;
  const demi = h.oblong ? Math.max(0, (h.oblong.longueur - h.d) / 2) : 0;
  if (demi === 0) {
    return Array.from({ length: segments }, (_, i) => {
      const a = (-2 * Math.PI * i) / segments;
      return { y: h.at.y + r * Math.cos(a), z: h.at.z + r * Math.sin(a) };
    });
  }
  // Deux demi-cercles reliés par deux droites, dans le repère (long, travers).
  const enY = h.oblong?.sens === 'y';
  const pt = (long: number, travers: number): Pt2 =>
    enY ? { y: h.at.y + long, z: h.at.z + travers } : { y: h.at.y + travers, z: h.at.z + long };
  const n = Math.max(4, Math.round(segments / 2));
  const out: Pt2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / n;
    out.push(pt(demi + r * Math.cos(a), r * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / n;
    out.push(pt(-demi + r * Math.cos(a), r * Math.sin(a)));
  }
  // Le sens horaire dépend de l'axe d'allongement : on le rétablit si besoin.
  return enY ? out : out.reverse();
}

/** Désignation d'un trou, telle qu'elle se cote : « Ø18 » ou « oblong 18 × 68 ». */
export function designationDeTrou(h: TrouDeTole): string {
  return h.oblong ? `oblong ${h.d} × ${Math.round(h.oblong.longueur)}` : `Ø${h.d}`;
}
