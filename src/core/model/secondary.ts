import type { SteelGradeId } from '../catalog/types';

/** Répartition d'une ossature secondaire : par entraxe imposé ou par nombre. */
export type SpacingMode = 'entraxe' | 'nombre';

/** Liernes : tirants qui bloquent le déversement des pannes à mi-portée. */
export interface SagBarParams {
  readonly enabled: boolean;
  /** Nombre de files de liernes par travée (1 = à mi-portée, 2 = aux tiers). */
  readonly rows: number;
  /** Diamètre du rond (mm). */
  readonly diameter: number;
}

/** Pannes : portent la couverture, posées perpendiculairement aux portiques. */
export interface PurlinParams {
  readonly enabled: boolean;
  readonly profile: string;
  readonly grade: SteelGradeId;
  readonly mode: SpacingMode;
  /** Entraxe suivant le rampant (mm), utilisé si `mode = 'entraxe'`. */
  readonly spacing: number;
  /** Nombre de pannes par versant, utilisé si `mode = 'nombre'`. */
  readonly count: number;
  /** Débord de toiture à l'égout, au-delà du nu du poteau (mm). */
  readonly eaveOverhang: number;
  /** Panne sablière à l'égout et panne faîtière. */
  readonly eavePurlin: boolean;
  readonly ridgePurlin: boolean;
  readonly sagBars: SagBarParams;
}

/** Lisses de bardage : portent le bardage sur les façades. */
export interface RailParams {
  readonly enabled: boolean;
  readonly profile: string;
  readonly grade: SteelGradeId;
  readonly mode: SpacingMode;
  readonly spacing: number;
  readonly count: number;
  /** Hauteur de la première lisse au-dessus du sol (mm) : arase du soubassement. */
  readonly sillHeight: number;
  /** Poser des lisses sur les pignons, en plus des longs pans. */
  readonly onGables: boolean;
}

/** Potelets de pignon : reprennent le vent sur la façade pignon. */
export interface GablePostParams {
  readonly enabled: boolean;
  readonly profile: string;
  readonly grade: SteelGradeId;
  readonly mode: SpacingMode;
  readonly spacing: number;
  readonly count: number;
  /**
   * Course verticale des oblongs de l'attache de tête, de part et d'autre (mm).
   * Elle doit couvrir la flèche de la traverse de pignon au droit des potelets,
   * que la vérification compare à elle ; le jeu sous la traverse en découle.
   */
  readonly courseTete: number;
}

export interface SecondaryParams {
  readonly purlins: PurlinParams;
  readonly rails: RailParams;
  readonly gablePosts: GablePostParams;
}

/**
 * Répartition d'éléments sur une longueur, selon le mode choisi.
 * Renvoie le nombre d'intervalles et l'entraxe réel obtenu — c'est cet
 * entraxe réel, jamais l'entraxe demandé, qui sera coté sur les plans.
 */
export function distribute(
  length: number,
  mode: SpacingMode,
  spacing: number,
  count: number,
): { intervals: number; actualSpacing: number } {
  const intervals =
    mode === 'entraxe'
      ? Math.max(1, Math.ceil(length / Math.max(1, spacing)))
      : Math.max(1, count);
  return { intervals, actualSpacing: length / intervals };
}
