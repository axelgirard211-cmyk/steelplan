/**
 * RÉGLAGES D'ATELIER — ce que le bureau d'études sait de l'atelier qui
 * fabriquera.
 *
 * Ils ne changent rien à la structure ; ils décident de la commande et des
 * contrôles. Une barre de 12 m débitée en pannes de 6 m laisse deux fois le
 * trait de scie et deux tombées : sans ces quelques millimètres, deux pannes de
 * 5 995 mm « tiennent » dans une barre qui, sur la scie, ne les sort pas.
 */
export type ClasseExecution = 'EXC1' | 'EXC2' | 'EXC3';

export interface AtelierParams {
  /**
   * Longueur MAXIMALE des barres de profils laminés — IPE, HEA, UPE — que
   * l'atelier approvisionne et sait manutentionner (mm). Le calepinage choisit
   * au mieux parmi les longueurs du commerce qui ne la dépassent pas.
   */
  readonly barreLaminee: number;
  /** Même chose pour les tubes, cornières, ronds et plats (mm). */
  readonly barreTube: number;
  /** Épaisseur du trait de scie (mm). */
  readonly traitDeScie: number;
  /** Tombée d'about : longueur perdue à chaque bout de barre, pour l'équerrer (mm). */
  readonly tombee: number;
  /** Une chute au moins aussi longue est stockée pour réemploi, et non ferraillée (mm). */
  readonly chuteReutilisable: number;
  /**
   * Part de chute au-delà de laquelle un schéma de coupe est abandonné, et ses
   * pièces commandées À LONGUEUR chez le négociant (0 à 1).
   */
  readonly chuteMaxi: number;
  /** Classe d'exécution (NF EN 1090-2) : elle fixe l'étendue des contrôles. */
  readonly classeExecution: ClasseExecution;
  /** Format des tôles du commerce, pour l'imbrication des platines (mm). */
  readonly toleLongueur: number;
  readonly toleLargeur: number;
  /** Jeu de découpe : entre deux pièces et au bord de la tôle (mm). */
  readonly jeuDecoupe: number;
}

export const ATELIER_PAR_DEFAUT: AtelierParams = {
  barreLaminee: 12_000,
  barreTube: 12_000,
  traitDeScie: 3,
  tombee: 10,
  chuteReutilisable: 1_000,
  chuteMaxi: 0.3,
  classeExecution: 'EXC2',
  toleLongueur: 3_000,
  toleLargeur: 1_500,
  jeuDecoupe: 10,
};

export const CLASSES_EXECUTION: readonly ClasseExecution[] = ['EXC1', 'EXC2', 'EXC3'];
