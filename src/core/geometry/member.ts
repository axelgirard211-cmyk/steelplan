import type { SteelGradeId } from '../catalog/types';
import { getProfile } from '../catalog/index';
import { EPS, RHO_ACIER, rad2deg } from '../math/tolerance';
import {
  add,
  cross,
  distance,
  dot,
  normalize,
  scale,
  sub,
  v3,
  type Vec3,
} from '../math/vec3';
import type { Hole } from './holes';
import { notchedVolume, type Notch } from './notches';
import { sectionOutline, type Pt2 } from './section';

/** Rôle d'une barre : pilote le préfixe de repère, la couleur 3D et les règles de plan. */
export type MemberRole =
  | 'poteau'
  | 'traverse'
  /** Porte-à-faux de toiture, boulonné sur la semelle extérieure du poteau. */
  | 'console'
  | 'jarret'
  | 'panne'
  | 'lisse'
  | 'potelet'
  /** Montant, linteau ou traverse basse bordant une ouverture de façade. */
  | 'chevetre'
  | 'membrure-sup'
  | 'membrure-inf'
  | 'montant'
  | 'diagonale'
  | 'contreventement'
  | 'lierne'
  | 'attache'
  /** Équerre soudée sur un poteau d'angle, où se boulonne la lisse de pignon. */
  | 'equerre'
  | 'libre';

/**
 * Plan de coupe d'about.
 *
 * C'est LA façon de décrire une coupe : un plan, pas un angle. L'angle de coupe
 * porté sur le plan de débit et la longueur de la fibre la plus longue s'en
 * déduisent exactement, quel que soit l'orientation de la barre.
 */
export interface CutPlane {
  /** Un point du plan (en général l'intersection avec l'axe de la barre). */
  readonly point: Vec3;
  /** Normale unitaire, orientée vers l'EXTÉRIEUR de la barre. */
  readonly normal: Vec3;
}

/** Barre prismatique : le composant élémentaire du modèle structurel. */
export interface Member {
  readonly id: string;
  readonly role: MemberRole;
  readonly profileId: string;
  readonly grade: SteelGradeId;
  /** Points de travail de l'axe (fibre neutre), en mm. */
  readonly start: Vec3;
  readonly end: Vec3;
  /** Direction de la hauteur de section (axe z local), unitaire et ⊥ à l'axe. */
  readonly up: Vec3;
  /**
   * Section retournée en miroir autour de son axe z.
   *
   * Sans effet sur un profil symétrique (I, tube, plat, rond), indispensable
   * pour les cornières dos à dos : les deux cornières d'une membrure double ne
   * sont pas deux copies translatées, ce sont deux pièces symétriques.
   */
  readonly mirrored: boolean;
  readonly cutStart: CutPlane;
  readonly cutEnd: CutPlane;
  /**
   * Perçages portés par la pièce, repérés dans SON système (abscisse depuis
   * l'about d'origine + position dans la section). Remplis par le générateur
   * d'assemblages, jamais à la main : c'est ce qui garantit qu'un trou de
   * platine et le trou de la pièce qu'elle assemble ne peuvent pas diverger.
   */
  readonly holes: readonly Hole[];
  /**
   * Grugeages et becquets portés par la pièce, repérés dans son système comme
   * les perçages. Ils retirent de la matière : les masses en tiennent compte.
   */
  readonly notches: readonly Notch[];
  /**
   * Fentes d'about d'un tube, où s'engage le plat d'attache. Déduites du plat
   * posé par le générateur d'assemblages — absentes sur toute autre barre.
   */
  readonly fentes?: readonly Fente[];
  /**
   * Barre sur laquelle celle-ci est SOUDÉE en atelier — une échantignolle sur
   * sa traverse —, ou `null` pour une pièce principale.
   *
   * ⚠ C'est ce qui sépare la PIÈCE de l'ASSEMBLAGE. Une pièce soudée sur une
   * autre ne se lève pas, ne se colise pas et ne se monte pas seule : elle
   * quitte l'atelier avec son porteur, et c'est sur le plan de celui-ci qu'on la
   * positionne.
   */
  readonly porteur: string | null;
  /** Repère de débit (PO1, TR2…), attribué par le repérage automatique. */
  readonly mark: string;
  /**
   * Repère d'ASSEMBLAGE : celui qui est peint sur la pièce finie, porté au plan
   * de montage et au colisage. Égal au repère de débit tant que toutes les
   * pièces d'un repère reçoivent les mêmes tôles et les mêmes pièces soudées ;
   * suffixé d'une lettre sinon (TR1A, TR1B). Une pièce soudée porte celui de
   * son porteur.
   */
  readonly assemblage: string;
  /** Libellé de position, ex. « file 3 — long pan gauche ». */
  readonly position: string;
}

/**
 * FENTE D'ABOUT — sciée au débit dans les deux parois du tube, elle reçoit le
 * plat d'attache. C'est une opération de la scie, pas de l'assembleur : elle
 * doit figurer sur le plan de la PIÈCE, que lit le débiteur.
 */
export interface Fente {
  readonly about: 'origine' | 'extremite';
  /** Longueur depuis l'about (mm) : celle sur laquelle le plat est engagé. */
  readonly longueur: number;
  /** Largeur de trait (mm) : l'épaisseur du plat, plus le jeu d'engagement. */
  readonly largeur: number;
}

/** Repère local orthonormé d'une barre. */
export interface MemberFrame {
  /** Axe de la barre, du départ vers l'arrivée. */
  readonly ax: Vec3;
  /** Largeur de section (axe y local). */
  readonly ay: Vec3;
  /** Hauteur de section (axe z local). */
  readonly az: Vec3;
}

/**
 * Repère local. `up` est ré-orthogonalisé contre l'axe : le constructeur de
 * barres peut donner une direction approchée sans casser l'orthonormalité.
 */
export function memberFrame(m: Member): MemberFrame {
  const ax = normalize(sub(m.end, m.start));
  const azBrut = sub(m.up, scale(ax, dot(m.up, ax)));
  const az = normalize(azBrut);
  const ay = cross(az, ax);
  // Le miroir inverse la largeur de section, jamais sa hauteur ni son axe :
  // le repère devient indirect, ce qui est exactement le sens d'une symétrie.
  return { ax, ay: m.mirrored ? scale(ay, -1) : ay, az };
}

/** Longueur entre points de travail (mm) — ce n'est PAS la longueur de débit. */
export function workLength(m: Member): number {
  return distance(m.start, m.end);
}

/**
 * Position d'un point de la section, à l'abscisse `s` le long de l'axe.
 * Repère : P = start + s·ax + y·ay + z·az.
 */
export function sectionPointAt(f: MemberFrame, origin: Vec3, s: number, p: Pt2): Vec3 {
  return add(add(origin, scale(f.ax, s)), add(scale(f.ay, p.y), scale(f.az, p.z)));
}

/**
 * Abscisse, le long de l'axe, où la fibre passant par le point de section `p`
 * rencontre le plan de coupe. Sert autant au maillage 3D qu'au calcul des
 * longueurs de débit.
 */
export function fibreAbscissa(f: MemberFrame, origin: Vec3, plane: CutPlane, p: Pt2): number {
  const base = add(origin, add(scale(f.ay, p.y), scale(f.az, p.z)));
  const denom = dot(plane.normal, f.ax);
  if (Math.abs(denom) < EPS) {
    throw new Error('Plan de coupe parallèle à l’axe de la barre : géométrie impossible.');
  }
  return dot(sub(plane.point, base), plane.normal) / denom;
}

/** Longueurs caractéristiques d'une barre, mesurées entre ses deux plans de coupe. */
export interface CutLengths {
  /** Longueur sur l'axe neutre (mm). */
  readonly axis: number;
  /** Fibre la plus courte (mm) — le débiteur scie à cette cote côté court. */
  readonly min: number;
  /** Fibre la plus longue (mm) — c'est elle qui définit la barre à commander. */
  readonly max: number;
}

/**
 * Longueurs de débit exactes : on suit chaque point du contour de section le
 * long de la barre et on mesure entre les deux plans de coupe.
 */
export function cutLengths(m: Member): CutLengths {
  const f = memberFrame(m);
  const profile = getProfile(m.profileId);
  const { outer } = sectionOutline(profile);

  const s0Axe = fibreAbscissa(f, m.start, m.cutStart, { y: 0, z: 0 });
  const s1Axe = fibreAbscissa(f, m.start, m.cutEnd, { y: 0, z: 0 });

  let min = Infinity;
  let max = -Infinity;
  for (const p of outer) {
    const l = fibreAbscissa(f, m.start, m.cutEnd, p) - fibreAbscissa(f, m.start, m.cutStart, p);
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return { axis: s1Axe - s0Axe, min, max };
}

/**
 * Angle de coupe d'un about : écart entre le plan de coupe et le plan
 * perpendiculaire à l'axe. 0° = coupe droite ; c'est la valeur portée sur le
 * plan de débit et affichée sur la scie.
 */
export function cutAngle(m: Member, bout: 'start' | 'end'): number {
  const f = memberFrame(m);
  const n = bout === 'start' ? m.cutStart.normal : m.cutEnd.normal;
  const c = Math.min(1, Math.abs(dot(normalize(n), f.ax)));
  return Math.acos(c);
}

/** Angle de coupe en degrés, arrondi au dixième (cote de plan). */
export function cutAngleDeg(m: Member, bout: 'start' | 'end'): number {
  return Math.round(rad2deg(cutAngle(m, bout)) * 10) / 10;
}

/** Plan de coupe droit, perpendiculaire à l'axe, passant par `point`. */
export function squareCut(point: Vec3, axisDir: Vec3, sortant: 1 | -1): CutPlane {
  return { point, normal: scale(normalize(axisDir), sortant) };
}

/**
 * Coupe d'onglet entre deux barres qui se rencontrent en un nœud (jonction
 * poteau-traverse, faîtage).
 *
 * Les deux directions partent du nœud et suivent chacune sa barre. La normale
 * `sortieVoisin − sortieSelf` est automatiquement orientée vers l'extérieur de
 * la barre concernée, que le nœud soit à son départ ou à son arrivée.
 *
 * Propriété vérifiée par les tests : si les barres forment un angle ψ, chacune
 * est coupée à 90° − ψ/2 de son plan droit, et la somme des deux angles de
 * coupe referme exactement le changement de direction.
 */
export function miterCut(point: Vec3, sortieSelf: Vec3, sortieVoisin: Vec3): CutPlane {
  const u = normalize(sortieSelf);
  const v = normalize(sortieVoisin);
  const d = sub(v, u);
  if (Math.hypot(d.x, d.y, d.z) < EPS) {
    throw new Error('Coupe d’onglet impossible : les deux barres sont confondues.');
  }
  return { point, normal: normalize(d) };
}

/**
 * Masse d'une barre (kg), sur la longueur de débit à l'axe, GRUGEAGES DÉDUITS.
 * Une pièce grugée pèse moins que la barre dont elle sort : c'est la masse
 * finie qui part au chantier, et c'est elle qu'on facture.
 */
export function memberMassKg(m: Member): number {
  const profil = getProfile(m.profileId);
  const brut = (profil.G * cutLengths(m).axis) / 1000;
  const retire = (notchedVolume(profil, m.notches) * RHO_ACIER);
  return brut - retire;
}

/** Surface à peindre d'une barre (m²). */
export function memberPaintM2(m: Member): number {
  return (getProfile(m.profileId).perimeter * cutLengths(m).axis) / 1e6;
}

/** Milieu de la barre, pour poser une étiquette ou une cote. */
export function midPoint(m: Member): Vec3 {
  return v3((m.start.x + m.end.x) / 2, (m.start.y + m.end.y) / 2, (m.start.z + m.end.z) / 2);
}
