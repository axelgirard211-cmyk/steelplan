import type { SteelGradeId } from '../catalog/types';

/** Type de liaison en pied de poteau. */
export type BaseFixity = 'articule' | 'encastre';

/**
 * Jarret : renfort triangulaire soudé sous la traverse à sa jonction avec le
 * poteau, obtenu en découpant un tronçon du même profil dans la diagonale.
 */
export interface HaunchParams {
  readonly enabled: boolean;
  /** Longueur du jarret suivant le rampant (mm). */
  readonly length: number;
  /** Hauteur totale traverse + renfort au droit du poteau (mm). */
  readonly depth: number;
}

/** Portique à âme pleine : poteaux + traverses. */
export interface FrameParams {
  readonly enabled: boolean;
  readonly columnProfile: string;
  readonly rafterProfile: string;
  readonly grade: SteelGradeId;
  readonly baseFixity: BaseFixity;
  /** Jarret en pied de traverse (jonction poteau). */
  readonly haunch: HaunchParams;
  /** Renfort au faîtage. */
  readonly ridgeHaunch: HaunchParams;
  /**
   * Les portiques de rive (pignons) reprennent moins de charge : on peut y
   * mettre un profil plus léger.
   */
  readonly distinctGableFrame: boolean;
  readonly gableColumnProfile: string;
  readonly gableRafterProfile: string;
}
