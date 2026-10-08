/**
 * Charges et combinaisons. Les valeurs sont SAISIES par l'utilisateur (elles
 * dépendent de la région, de l'altitude, du site) : SteelPlan ne les calcule
 * pas et ne prétend pas remplacer une note de calcul.
 *
 * Unité des charges surfaciques : kN/m². Unité des charges linéiques : kN/m.
 */
export interface LoadParams {
  /** Poids propre de la couverture et des équipements suspendus (kN/m²). */
  readonly permanent: number;
  /**
   * Le poids propre de l'ossature est calculé par le modèle : ne pas le
   * réintégrer dans `permanent`.
   */
  readonly includeSelfWeight: boolean;
  /** Charge d'exploitation d'entretien de toiture (kN/m²). */
  readonly exploitation: number;
  /** Charge de neige normale sur la projection horizontale (kN/m²). */
  readonly neige: number;
  /** Charge de neige accidentelle (kN/m²). */
  readonly neigeAccidentelle: number;
  /** Pression de vent sur la façade au vent (kN/m²). */
  readonly ventPression: number;
  /** Dépression de vent en toiture, valeur positive (kN/m²). */
  readonly ventDepression: number;
}

/** Limites de flèche, exprimées par le dénominateur de L/n. */
export interface DeflectionLimits {
  /** Traverse ou arbalétrier. */
  readonly rafter: number;
  /** Panne. */
  readonly purlin: number;
  /** Lisse. */
  readonly rail: number;
  /** Déplacement horizontal en tête de poteau (H/n). */
  readonly columnDrift: number;
}

/**
 * Coefficients partiels ELU (EN 1990) et facteurs de combinaison ψ0.
 * Valeurs recommandées, modifiables : certaines annexes nationales diffèrent.
 */
export interface CombinationFactors {
  /** γG défavorable sur les actions permanentes. */
  readonly gammaG: number;
  /** γQ sur les actions variables. */
  readonly gammaQ: number;
  readonly psi0Neige: number;
  readonly psi0Vent: number;
  readonly psi0Exploitation: number;
}

export interface LoadModel {
  readonly loads: LoadParams;
  readonly deflection: DeflectionLimits;
  readonly factors: CombinationFactors;
}
