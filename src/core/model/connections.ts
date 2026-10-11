/**
 * Paramètres d'assemblage. Les perçages ne sont PAS décrits ici : ils sont
 * déduits de ces paramètres par le générateur (phase P4), pour qu'une platine
 * et les trous de la pièce qu'elle assemble ne puissent jamais diverger.
 */

import type { SoudureSemelles } from '../geometry/weld';

/** Diamètres de boulons normalisés (mm). */
export const BOLT_DIAMETERS = [12, 14, 16, 20, 22, 24, 27, 30] as const;
export type BoltDiameter = (typeof BOLT_DIAMETERS)[number];

/** Classes de qualité courantes en charpente. */
export type BoltClass = '8.8' | '10.9';

export interface BoltSpec {
  readonly d: BoltDiameter;
  readonly cls: BoltClass;
}

/**
 * Jeu au perçage (mm) : diamètre du trou = diamètre du boulon + jeu.
 * EN 1090-2 : 1 mm jusqu'à M14, 2 mm de M16 à M24, 3 mm au-delà.
 */
export function holeClearance(d: BoltDiameter): number {
  if (d <= 14) return 1;
  if (d <= 24) return 2;
  return 3;
}

/** Diamètre de perçage (mm). */
export function holeDiameter(b: BoltSpec): number {
  return b.d + holeClearance(b.d);
}

/**
 * Pinces et entraxes minimaux (EN 1993-1-8 tableau 3.3), en fonction du
 * diamètre du trou d0 :
 *  - pince longitudinale e1 ≥ 1,2·d0 ; pince transversale e2 ≥ 1,2·d0 ;
 *  - entraxe p1 ≥ 2,2·d0 ; p2 ≥ 2,4·d0.
 */
export function minEdgeDistance(b: BoltSpec): number {
  return 1.2 * holeDiameter(b);
}

export function minPitch(b: BoltSpec): number {
  return 2.2 * holeDiameter(b);
}

export function minGauge(b: BoltSpec): number {
  return 2.4 * holeDiameter(b);
}

/** Platine d'about (traverse–poteau, faîtage). */
export interface EndPlateParams {
  readonly thickness: number;
  readonly bolt: BoltSpec;
  /** Nombre de rangées de boulons (suivant la hauteur de la platine). */
  readonly rows: number;
  /** Nombre de files (suivant la largeur), en général 2. */
  readonly cols: number;
  /** Pince longitudinale, du bord de platine au premier trou (mm). */
  readonly edgeDistance: number;
  /** Entraxe entre files (mm). */
  readonly gauge: number;
  /** Débord de la platine au-delà de la semelle (mm). */
  readonly overhang: number;
  /**
   * Soudure des semelles de la barre sur la platine : cordons d'angle, ou bout
   * à bout à pleine pénétration quand la gorge que permet la semelle ne suffit
   * pas à transmettre l'effort.
   */
  readonly soudureSemelles: SoudureSemelles;
}

/**
 * Classe de résistance du béton de la fondation, EN 206.
 *
 * ⚠ Elle manquait au modèle, et sans elle aucun pied de poteau ne peut être
 * vérifié : la pression admissible sous la platine se déduit de fck, rien
 * d'autre. Une platine se dimensionne sur le béton bien avant de se dimensionner
 * sur l'acier.
 */
export type ClasseBeton = 'C20/25' | 'C25/30' | 'C30/37' | 'C35/45' | 'C40/50';

/** Résistance caractéristique en compression fck (N/mm²). */
export const FCK: Readonly<Record<ClasseBeton, number>> = {
  'C20/25': 20,
  'C25/30': 25,
  'C30/37': 30,
  'C35/45': 35,
  'C40/50': 40,
};

/** Pied de poteau : platine + tiges d'ancrage. */
export interface BasePlateParams {
  readonly thickness: number;
  readonly width: number;
  readonly length: number;
  /** Diamètre des tiges d'ancrage (mm). */
  readonly anchorDiameter: number;
  /** Nombre de tiges (2 pour un pied articulé, 4 ou plus si encastré). */
  readonly anchorCount: number;
  /** Longueur de scellement (mm). */
  readonly anchorEmbedment: number;
  /** Épaisseur du mortier de calage (mm). */
  readonly groutThickness: number;
  /** Bêche de cisaillement soudée sous la platine. */
  readonly shearKey: boolean;
  /** Béton de la fondation : il fixe la pression admissible sous la platine. */
  readonly concrete: ClasseBeton;
}

/** Tige d'ancrage d'un pied de poteau, et son trou volontairement généreux. */
export function tigeDAncrage(cb: BasePlateParams): { bolt: BoltSpec; dTrou: number } {
  const bolt: BoltSpec = { d: Math.min(30, Math.max(12, cb.anchorDiameter)) as BoltSpec['d'], cls: '8.8' };
  return { bolt, dTrou: holeDiameter(bolt) + 4 };
}

/**
 * Implantation des tiges sous une platine de pied de poteau, dans son repère :
 * `y` selon sa largeur, `z` selon sa longueur (la hauteur du poteau).
 * 2 tiges ⇒ une file, 4 ou plus ⇒ deux files.
 *
 * ⚠ Une seule écriture : la construction pose les trous ici, la saisie vérifie
 * ici qu'aucune tige ne tombe sous le poteau.
 */
export function positionsDesAncrages(cb: BasePlateParams): { y: number; z: number }[] {
  const { bolt, dTrou } = tigeDAncrage(cb);
  const files = cb.anchorCount <= 2 ? 1 : 2;
  const rangees = Math.max(1, Math.round(cb.anchorCount / files));
  const pince = Math.max(1.5 * dTrou, minEdgeDistance(bolt));
  const out: { y: number; z: number }[] = [];
  for (let i = 0; i < rangees; i++) {
    const z = rangees === 1 ? 0 : (i / (rangees - 1) - 0.5) * 2 * (cb.length / 2 - pince);
    for (let j = 0; j < files; j++) {
      out.push({ y: files === 1 ? 0 : (j - 0.5) * 2 * (cb.width / 2 - pince), z });
    }
  }
  return out;
}

/** Gousset de treillis. */
export interface GussetParams {
  readonly thickness: number;
  readonly bolt: BoltSpec;
  /** Marge de tôle au-delà du dernier trou (mm). */
  readonly edgeMargin: number;
}

/** Éclisse de continuité (traverse en deux tronçons). */
export interface SpliceParams {
  readonly enabled: boolean;
  readonly thickness: number;
  readonly bolt: BoltSpec;
  readonly rows: number;
}

/**
 * Cornière d'attache (échantignole) : la pièce qui reprend une panne sur la
 * traverse. C'est une VRAIE pièce à débiter et à repérer, pas seulement un
 * groupe de trous.
 */
export interface CleatParams {
  readonly enabled: boolean;
  readonly profile: string;
  /** Longueur du tronçon de cornière (mm). */
  readonly length: number;
}

export interface ConnectionParams {
  /** Assemblage traverse–poteau. */
  readonly rafterToColumn: EndPlateParams;
  /** Assemblage de faîtage. */
  readonly ridge: EndPlateParams;
  readonly columnBase: BasePlateParams;
  readonly gusset: GussetParams;
  readonly splice: SpliceParams;
  /** Boulonnerie par défaut des attaches secondaires (pannes, lisses). */
  readonly secondaryBolt: BoltSpec;
  /** Cornières d'attache des pannes. */
  readonly purlinCleat: CleatParams;
}
