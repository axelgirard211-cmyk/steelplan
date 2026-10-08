import { deg2rad } from '../math/tolerance';

/** Type de toiture. */
export type RoofType = 'bipente' | 'monopente';

/** Unité de saisie de la pente. */
export type SlopeUnit = 'pourcent' | 'degres';

/**
 * Trame du bâtiment. C'est le squelette dont tout le reste dépend.
 *
 * Repère : X = longueur du bâtiment (sens des travées), Y = largeur (portée),
 * Z = vertical. Le portique est dans un plan X = constante.
 */
export interface GridParams {
  /** Nombre de travées ; il y a donc `nBays + 1` files de portiques. */
  readonly nBays: number;
  /** Entraxe des portiques (mm). */
  readonly baySpacing: number;
  /** Portée, de nu extérieur à nu extérieur de poteau (mm). */
  readonly span: number;
  /** Hauteur à l'égout, du pied de poteau au dessus de la traverse (mm). */
  readonly eaveHeight: number;
  readonly roofType: RoofType;
  readonly slopeUnit: SlopeUnit;
  /** Pente du versant gauche (ou pente unique en monopente). */
  readonly slope: number;
  /** Pente du versant droit ; ignorée en monopente. */
  readonly slopeRight: number;
  /** Versants dissymétriques : si faux, `slopeRight` suit `slope`. */
  readonly asymmetric: boolean;
}

/** Pente exprimée en radians, quelle que soit l'unité de saisie. */
export function slopeAngle(unit: SlopeUnit, value: number): number {
  return unit === 'degres' ? deg2rad(value) : Math.atan(value / 100);
}

/** Pente du versant gauche (rad). */
export function leftSlopeRad(g: GridParams): number {
  return slopeAngle(g.slopeUnit, g.slope);
}

/** Pente du versant droit (rad). */
export function rightSlopeRad(g: GridParams): number {
  return slopeAngle(g.slopeUnit, g.asymmetric ? g.slopeRight : g.slope);
}

/**
 * Position du faîtage selon Y (mm), mesurée depuis le poteau gauche.
 * En bipente symétrique c'est le milieu ; en bipente dissymétrique, le point
 * où les deux versants se rencontrent ; en monopente, le poteau de droite.
 */
export function ridgeY(g: GridParams): number {
  if (g.roofType === 'monopente') return g.span;
  const a = Math.tan(leftSlopeRad(g));
  const b = Math.tan(rightSlopeRad(g));
  // a·y = b·(span − y)  ⇒  y = b·span / (a + b)
  return (b * g.span) / (a + b);
}

/** Hauteur au faîtage (mm), déduite de la portée, de l'égout et des pentes. */
export function ridgeHeight(g: GridParams): number {
  return g.eaveHeight + ridgeY(g) * Math.tan(leftSlopeRad(g));
}

/** Longueur totale du bâtiment (mm). */
export function buildingLength(g: GridParams): number {
  return g.nBays * g.baySpacing;
}

/** Abscisses X des files de portiques (mm). */
export function frameStations(g: GridParams): number[] {
  return Array.from({ length: g.nBays + 1 }, (_, i) => i * g.baySpacing);
}

/** Longueur développée d'un rampant, du poteau au faîtage (mm). */
export function rafterLength(g: GridParams, side: 'gauche' | 'droite'): number {
  const yr = ridgeY(g);
  const run = side === 'gauche' ? yr : g.span - yr;
  const angle = side === 'gauche' ? leftSlopeRad(g) : rightSlopeRad(g);
  return run / Math.cos(angle);
}

/**
 * Altitude de la ligne de toiture (axe des traverses ou des arbalétriers) à
 * l'abscisse transversale `y`. C'est la fonction que consomment les pannes,
 * les potelets et les fermes pour se poser sur le versant.
 */
export function roofZ(g: GridParams, y: number): number {
  if (g.roofType === 'monopente') return g.eaveHeight + y * Math.tan(leftSlopeRad(g));
  const yr = ridgeY(g);
  return y <= yr
    ? g.eaveHeight + y * Math.tan(leftSlopeRad(g))
    : g.eaveHeight + (g.span - y) * Math.tan(rightSlopeRad(g));
}

/** Versant sur lequel tombe l'abscisse `y`. */
export function roofSide(g: GridParams, y: number): 'gauche' | 'droite' {
  if (g.roofType === 'monopente') return 'gauche';
  return y <= ridgeY(g) ? 'gauche' : 'droite';
}

/** Pente (rad) du versant à l'abscisse `y`. */
export function roofSlopeAt(g: GridParams, y: number): number {
  return roofSide(g, y) === 'gauche' ? leftSlopeRad(g) : rightSlopeRad(g);
}

/**
 * Direction unitaire du rampant à l'abscisse `y`, orientée vers le haut
 * (donc vers le faîtage). Sert à orienter les pannes et les liernes.
 */
export function roofUphill(g: GridParams, y: number): { y: number; z: number } {
  const a = roofSlopeAt(g, y);
  const sens = roofSide(g, y) === 'gauche' ? 1 : -1;
  return { y: sens * Math.cos(a), z: Math.sin(a) };
}

/**
 * Normale unitaire au versant à l'abscisse `y`, tournée vers le ciel.
 * C'est la direction dans laquelle on empile traverse puis panne.
 */
export function roofNormal(g: GridParams, y: number): { y: number; z: number } {
  const a = roofSlopeAt(g, y);
  const sens = roofSide(g, y) === 'gauche' ? 1 : -1;
  return { y: -sens * Math.sin(a), z: Math.cos(a) };
}

/** Surface de toiture développée (m²). */
export function roofArea(g: GridParams): number {
  const l = buildingLength(g);
  const dev =
    g.roofType === 'monopente'
      ? rafterLength(g, 'gauche')
      : rafterLength(g, 'gauche') + rafterLength(g, 'droite');
  return (dev * l) / 1e6;
}

/** Emprise au sol (m²). */
export function footprintArea(g: GridParams): number {
  return (g.span * buildingLength(g)) / 1e6;
}
