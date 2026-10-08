import type { SteelGradeId } from '../catalog/types';
import type { MemberRole } from '../geometry/member';
import type { Combination } from '../analysis/loadCases';
import type { AssemblageCheck } from './assemblages/types';
import type { EnveloppeAppui } from './reactions';
import type { SectionClass } from './section';

/**
 * RÉSULTATS DES VÉRIFICATIONS.
 *
 * ⚠ Toutes les valeurs affichées sont en unités d'ingénieur — kN, kN·m, mm — et
 * non en unités internes, parce qu'un rapport se relit et se recoupe à la main.
 * La conversion a lieu une seule fois, au moment de constituer ces lignes.
 */

/** Les cinq vérifications menées sur un élément. */
export interface Ratios {
  /** Résistance de section : interaction effort normal + moment. */
  readonly section: number;
  readonly cisaillement: number;
  /** Flambement par flexion sous effort normal seul. */
  readonly flambement: number;
  /**
   * Stabilité sous effort normal ET moment : interaction flambement +
   * déversement.
   *
   * ⚠ Ce taux n'est pas « le déversement » — il l'inclut. Le nommer déversement
   * faisait afficher « gouverné par le déversement » sur des barres dont c'était
   * l'effort normal qui décidait, et rendait le rapport trompeur là où il doit
   * être explicite.
   */
  readonly stabilite: number;
  /** Flèche ou déplacement en tête, rapporté à sa limite. */
  readonly fleche: number;
  /**
   * Élancement géométrique λ = Lcr/i, rapporté à la limite de bonne pratique.
   *
   * ⚠ Ce taux n'est pas normatif — l'EN 1993-1-1 ne fixe plus de limite. Il est
   * là parce que le dimensionnement automatique, laissé libre, propose des
   * cornières de 20 mm en palée de stabilité : elles passent au calcul et
   * personne ne les monterait.
   */
  readonly elancement: number;
}

export const RATIO_LABELS: Record<keyof Ratios, string> = {
  section: 'résistance de section',
  cisaillement: 'cisaillement',
  flambement: 'flambement',
  stabilite: 'stabilité N + M',
  fleche: 'flèche',
  elancement: 'élancement',
};

export interface CheckLine {
  /** Repère de la pièce : c'est lui qui relie le rapport aux plans et à la 3D. */
  readonly mark: string;
  /** Barre analysée dont la ligne est tirée, quand elle vient du portique. */
  readonly memberId?: string;
  readonly role: MemberRole;
  readonly profileId: string;
  readonly grade: SteelGradeId;
  readonly cls: SectionClass;
  /** Combinaison la plus défavorable, et son libellé. */
  readonly combinaison: string;
  /** Sollicitations de calcul : kN, kN·m. */
  readonly nEd: number;
  readonly myEd: number;
  readonly vEd: number;
  readonly ratios: Ratios;
  /** Taux de travail global, maximum des cinq. */
  readonly ratio: number;
  readonly gouverne: keyof Ratios;
  /** Élancement constaté et limite retenue, pour que le critère soit lisible. */
  readonly elancement: { readonly valeur: number; readonly limite: number } | null;
  /** Flèche constatée et limite admise (mm), quand la vérification s'applique. */
  readonly fleche: { readonly valeur: number; readonly limite: number } | null;
  readonly avertissements: readonly string[];
  /** Longueurs de flambement retenues (mm), affichées car ce sont des hypothèses. */
  readonly lcrY: number;
  readonly lcrZ: number;
}

/**
 * Pièce que SteelPlan ne vérifie pas, et pourquoi.
 *
 * ⚠ Une pièce absente du rapport serait lue comme vérifiée. Les exclusions sont
 * donc NOMMÉES et affichées : la vue 3D les distingue d'une pièce conforme, et
 * le rapport les liste. Le silence n'est pas une réponse acceptable.
 */
export interface NonVerifie {
  readonly mark: string;
  readonly role: MemberRole;
  readonly raison: string;
}

/** Réaction d'un pied de potelet (kN). */
export interface AppuiPotelet {
  readonly mark: string;
  readonly n: number;
  readonly v: number;
  readonly combinaison: string;
}

export interface ChecksReport {
  readonly lines: readonly CheckLine[];
  /**
   * Descente de charges : ce que chaque pied rend à sa fondation.
   *
   * ⚠ Sans elle, le bureau d'études béton ne peut calculer aucune semelle. Le
   * solveur la produisait déjà à chaque combinaison — elle n'était simplement
   * lue nulle part.
   */
  readonly reactions: readonly EnveloppeAppui[];
  /**
   * Pieds de potelets, articulés : l'effort tranchant MAXIMAL sur toutes les
   * combinaisons ELU, avec celle qui le produit.
   *
   * ⚠ Pas l'effort de la ligne de vérification : celle-ci garde la combinaison
   * qui gouverne le TAUX — l'élancement, pour un potelet court, qui ne dépend
   * d'aucune — et annonçait alors au maçon un pied sans effort de vent.
   */
  readonly piedsPotelets: readonly AppuiPotelet[];
  /**
   * Vérification des ASSEMBLAGES, distincte de celle des barres.
   *
   * ⚠ Elle n'existait pas : SteelPlan éditait des plans de fabrication complets
   * pour des assemblages dont aucun boulon n'avait jamais été calculé.
   */
  readonly assemblages: readonly AssemblageCheck[];
  readonly nonVerifiables: readonly NonVerifie[];
  /** Taux de travail par repère : la vue 3D s'en sert pour colorer les pièces. */
  readonly byMark: ReadonlyMap<string, number>;
  readonly combinations: readonly Combination[];
  /** Hypothèses de calcul, imprimées avec le rapport. */
  readonly hypotheses: readonly string[];
  readonly maxRatio: number;
  /** Nombre de repères dont le taux dépasse 1. */
  readonly nonVerifies: number;
  readonly ms: number;
}

/** Avertissement permanent, affiché partout où un résultat de calcul apparaît. */
export const AVERTISSEMENT =
  'Pré-dimensionnement indicatif — ne remplace pas la note de calcul d’un bureau d’études.';

/**
 * Fusion de deux lignes portant sur la même pièce, sous deux combinaisons.
 *
 * ⚠ On retient le maximum de CHAQUE vérification, et non la ligne dont le taux
 * global est le plus élevé. La différence n'est pas cosmétique : la résistance est
 * gouvernée par une combinaison ELU, la flèche par une combinaison ELS. Ne garder
 * que la ligne la plus défavorable ferait disparaître la flèche du rapport — la
 * vérification aurait bien eu lieu, mais son résultat serait invisible.
 *
 * Chaque taux garde la trace de la combinaison qui l'a produit : celle affichée
 * est celle du taux gouvernant.
 */
export function fusionner(a: CheckLine, b: CheckLine): CheckLine {
  const ratios: Ratios = {
    section: Math.max(a.ratios.section, b.ratios.section),
    cisaillement: Math.max(a.ratios.cisaillement, b.ratios.cisaillement),
    flambement: Math.max(a.ratios.flambement, b.ratios.flambement),
    stabilite: Math.max(a.ratios.stabilite, b.ratios.stabilite),
    fleche: Math.max(a.ratios.fleche, b.ratios.fleche),
    elancement: Math.max(a.ratios.elancement, b.ratios.elancement),
  };
  const { ratio, gouverne } = pire(ratios);
  const source = b.ratios[gouverne] > a.ratios[gouverne] ? b : a;
  const cotéFleche = b.ratios.fleche > a.ratios.fleche ? b : a;
  return {
    ...source,
    ratios,
    ratio,
    gouverne,
    fleche: cotéFleche.fleche,
    avertissements: [...new Set([...a.avertissements, ...b.avertissements])],
  };
}

/** Le plus défavorable des cinq taux, et lequel gouverne. */
export function pire(r: Ratios): { ratio: number; gouverne: keyof Ratios } {
  let gouverne: keyof Ratios = 'section';
  let ratio = -Infinity;
  for (const k of Object.keys(r) as (keyof Ratios)[]) {
    if (r[k] > ratio) {
      ratio = r[k];
      gouverne = k;
    }
  }
  return { ratio: Math.max(0, ratio), gouverne };
}
