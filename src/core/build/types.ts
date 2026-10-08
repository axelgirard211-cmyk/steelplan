import type { SteelGradeId } from '../catalog/types';
import type { Member, MemberRole } from '../geometry/member';
import type { Oblong } from '../geometry/holes';
import type { Pt2 } from '../geometry/section';
import type { Weld } from '../geometry/weld';
import type { Vec3 } from '../math/vec3';

/**
 * Jarret : renfort découpé en biais dans un profil et soudé sous la traverse.
 * Ce n'est pas une barre prismatique — sa hauteur décroît linéairement — d'où
 * un type à part plutôt qu'un `Member`.
 */
export interface Haunch {
  readonly id: string;
  readonly profileId: string;
  readonly grade: SteelGradeId;
  /** Extrémité pleine hauteur, au droit du poteau (sur l'axe de la traverse). */
  readonly root: Vec3;
  /** Pointe du renfort, sur l'axe de la traverse. */
  readonly tip: Vec3;
  /** Direction du renfort depuis l'axe de la traverse (vers le bas de la section). */
  readonly down: Vec3;
  /** Hauteur du renfort à la racine, sous la semelle inférieure de la traverse (mm). */
  readonly rootDepth: number;
  /**
   * Traverse sous laquelle le renfort est SOUDÉ — identifiant de barre.
   *
   * ⚠ Établi une fois, à la construction du modèle, par la géométrie : racine ET
   * pointe sur l'axe de la traverse. Les identifiants ne le disent pas — « 0-JG »
   * ne préfixe pas « 0-TG » — et la règle de nommage ne rattachait aucun jarret.
   */
  readonly porteur: string | null;
  readonly mark: string;
  readonly position: string;
}

/** Nature d'une tôle d'assemblage. */
export type PlateKind =
  | 'platine-about'
  | 'platine-pied'
  | 'gousset'
  | 'eclisse'
  | 'gousset-cv'
  | 'plat-tube'
  | 'gousset-tete';

/**
 * Désignation de chaque nature de tôle, telle qu'elle s'imprime partout.
 *
 * ⚠ Une seule table : elle était recopiée dans la nomenclature, les plans
 * d'assemblage et la fiche 3D, et une nature ajoutée à l'une manquait aux autres.
 */
export const LIBELLE_TOLE: Readonly<Record<PlateKind, string>> = {
  'platine-about': 'Platine d’about',
  'platine-pied': 'Platine de pied',
  gousset: 'Gousset',
  eclisse: 'Éclisse',
  'gousset-cv': 'Gousset de contreventement',
  'plat-tube': 'Plat d’about de tube',
  'gousset-tete': 'Gousset de tête de potelet',
};

/** Perçage d'une tôle : position dans son plan, traversant l'épaisseur. */
export interface PlateHole {
  readonly at: Pt2;
  readonly d: number;
  /** Trou oblong, allongé selon un axe de la tôle ; absent pour un trou rond. */
  readonly oblong?: Oblong;
}

/**
 * Tôle d'assemblage : platine d'about, platine de pied, gousset, éclisse.
 *
 * Elle est décrite par son CONTOUR dans son propre plan et son placement par un
 * repère orthonormé. Les perçages sont dans le même repère que le contour, donc
 * la tôle porte tout ce qu'il faut pour la débiter et la percer — c'est déjà son
 * plan de fabrication, avant même d'être dessiné.
 */
export interface Plate {
  readonly id: string;
  readonly kind: PlateKind;
  readonly grade: SteelGradeId;
  readonly thickness: number;
  /** Contour dans le plan de la tôle (mm), origine au centre du repère local. */
  readonly outline: readonly Pt2[];
  readonly holes: readonly PlateHole[];
  /**
   * Tôle avec laquelle celle-ci est boulonnée FACE À FACE, s'il y en a une.
   *
   * Deux platines de faîtage se boulonnent l'une contre l'autre : elles portent
   * donc chacune la totalité des trous, mais l'assemblage ne compte QU'UN jeu de
   * boulons. Sans cette information, la boulonnerie du faîtage serait comptée en
   * double — et une commande de boulons trop fournie de moitié ne se remarque
   * qu'à la livraison.
   */
  readonly pairedWith: string | null;
  /**
   * Barre sur laquelle la tôle est SOUDÉE en atelier — ou `null` pour une tôle
   * LIBRE, boulonnée au montage (éclisse, gousset), qui part en vrac.
   *
   * ⚠⚠ Explicite, et non déduit de l'identifiant. La règle « une tôle appartient
   * à la barre dont l'identifiant préfixe le sien » a soudé la platine d'about
   * de la traverse… sur le POTEAU, parce qu'elle était nommée d'après lui. Le
   * poteau partait avec une tôle qu'il ne doit pas porter, la traverse sans la
   * sienne, et les deux plans de fabrication étaient faux en même temps. Elle
   * soudait aussi les éclisses — qui ne sont soudées à rien.
   */
  readonly porteur: string | null;
  /** Origine du repère local, au centre de la tôle. */
  readonly origin: Vec3;
  /** Axe local y du contour (unitaire). */
  readonly u: Vec3;
  /** Axe local z du contour (unitaire). */
  readonly v: Vec3;
  readonly mark: string;
  readonly position: string;
}

/** Compteurs par rôle, pour la fiche de synthèse. */
export interface RoleStat {
  readonly count: number;
  readonly massKg: number;
}

export interface ModelStats {
  readonly memberCount: number;
  readonly haunchCount: number;
  readonly plateCount: number;
  /** Nombre total de boulons du projet, toutes tailles confondues. */
  readonly boltCount: number;
  readonly weldCount: number;
  /** Longueur totale de cordon à déposer (m). */
  readonly weldMetres: number;
  /** Nombre de repères distincts = nombre de pièces différentes à fabriquer. */
  readonly markCount: number;
  readonly massKg: number;
  readonly paintM2: number;
  readonly byRole: Readonly<Partial<Record<MemberRole, RoleStat>>>;
}

/**
 * Modèle structurel instancié : le résultat du générateur.
 *
 * Il est INTÉGRALEMENT recalculé à chaque modification de paramètre. Rien ici
 * n'est modifiable directement — pour changer quelque chose, on change le
 * paramètre correspondant dans `ProjectParams`.
 */
/**
 * Entraxes RÉELLEMENT obtenus après répartition (mm). Ce sont ces valeurs, et
 * jamais les entraxes demandés, qui seront cotées sur les plans.
 */
export interface ActualSpacings {
  readonly purlins: number;
  readonly rails: number;
}

export interface StructuralModel {
  readonly members: readonly Member[];
  readonly haunches: readonly Haunch[];
  readonly plates: readonly Plate[];
  readonly welds: readonly Weld[];
  readonly stats: ModelStats;
  readonly spacings: ActualSpacings;
  /** Durée de génération (ms), affichée pour tenir l'objectif de régénération. */
  readonly buildMs: number;
}
