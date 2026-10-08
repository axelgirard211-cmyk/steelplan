import type { SteelGradeId } from '../catalog/types';

/**
 * Forme du contreventement :
 * - `croix`     : croix de Saint-André, deux diagonales, travaillant en traction ;
 * - `diagonale` : une seule diagonale par maille ;
 * - `k`         : palée en K, quand une ouverture doit rester libre.
 */
export type BracingShape = 'croix' | 'diagonale' | 'k';

export interface BracingSet {
  readonly enabled: boolean;
  readonly shape: BracingShape;
  readonly profile: string;
  /**
   * Indices des travées contreventées (0 = première travée).
   * Vide ⇒ placement automatique : première et dernière travée.
   */
  readonly bays: readonly number[];
}

export interface BracingParams {
  /** Poutre au vent en toiture, dans le plan des versants. */
  readonly roof: BracingSet;
  /** Palées de stabilité en long pan, dans le plan des façades. */
  readonly wall: BracingSet;
  /** Contreventement de pignon. */
  readonly gable: BracingSet;
  readonly grade: SteelGradeId;
}

/**
 * Travées effectivement contreventées : la sélection explicite si elle existe,
 * sinon la première et la dernière travée (disposition courante).
 */
export function bracedBays(set: BracingSet, nBays: number): number[] {
  if (!set.enabled) return [];
  if (set.bays.length > 0) return set.bays.filter((b) => b >= 0 && b < nBays);
  return nBays <= 1 ? [0] : [0, nBays - 1];
}
