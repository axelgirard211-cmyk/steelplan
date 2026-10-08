import type { Poste } from './postes';
import type { SheetFormat } from './layout';
import type { DrawScene } from './scene';

/** Nature d'une planche, qui détermine son titre et son ordre dans le dossier. */
export type SheetKind =
  | 'ensemble'
  | 'elevation'
  | 'coupe'
  | 'debit'
  | 'fabrication'
  | 'detail'
  | 'fondations'
  | 'montage'
  | 'nomenclature'
  /** Documents de poste : calepinage, tôlerie, peinture, contrôle, colisage. */
  | 'atelier'
  /** Page de garde d'un dossier de poste : elle accompagne le dossier, hors numérotation. */
  | 'bordereau';

export interface Sheet {
  readonly id: string;
  readonly kind: SheetKind;
  readonly titre: string;
  readonly format: SheetFormat;
  /** Dénominateur de l'échelle normalisée retenue. */
  readonly echelle: number;
  readonly scene: DrawScene;
  /**
   * Postes destinataires, quand la planche les connaît mieux que la table de
   * diffusion (voir `destinataires`).
   */
  readonly postes?: readonly Poste[];
}
