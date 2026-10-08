import type { SteelGradeId } from '../catalog/types';

/**
 * Type de treillis.
 * - `warren`   : diagonales alternées en N, sans montants (ou avec).
 * - `pratt`    : montants verticaux, diagonales tendues vers le centre.
 * - `howe`     : inverse du Pratt, diagonales comprimées vers le centre.
 * - `polonceau`: ferme à entrait, typique des toitures à deux versants.
 */
export type TrussType = 'warren' | 'pratt' | 'howe' | 'polonceau';

/** Ferme treillis paramétrique. Alternative au portique à âme pleine. */
export interface TrussParams {
  readonly enabled: boolean;
  readonly type: TrussType;
  /** Nombre de panneaux (mailles) sur toute la portée. */
  readonly nPanels: number;
  /** Hauteur de la ferme à l'appui, entre axes des membrures (mm). */
  readonly heightAtSupport: number;
  /** Hauteur de la ferme au faîtage, entre axes des membrures (mm). */
  readonly heightAtRidge: number;
  /** Entrait droit (horizontal) ou retroussé (suivant une pente). */
  readonly straightTie: boolean;
  /** Ajouter des montants verticaux à un Warren. */
  readonly warrenWithPosts: boolean;

  /** Membrure supérieure (arbalétrier). */
  readonly topChordProfile: string;
  /** Membrure inférieure (entrait). */
  readonly bottomChordProfile: string;
  /** Montants. */
  readonly postProfile: string;
  /** Diagonales. */
  readonly diagonalProfile: string;
  readonly grade: SteelGradeId;

  /**
   * Membrures et treillis en double cornière dos à dos, séparées par
   * l'épaisseur du gousset. Cas le plus courant des fermes légères.
   */
  readonly doubleAngles: boolean;
}
