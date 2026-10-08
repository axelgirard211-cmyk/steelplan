import type { LoadModel } from '../model/loads';

/**
 * ACTIONS ET COMBINAISONS (EN 1990).
 *
 * Les valeurs des actions sont SAISIES : SteelPlan ne calcule ni la neige ni le
 * vent, qui dépendent de la région, de l'altitude, du site et de la forme du
 * bâtiment. Ce qu'il calcule, ce sont les COMBINAISONS — un travail purement
 * arithmétique où l'erreur humaine est fréquente et sans excuse.
 */

/** Actions élémentaires. */
export type ActionId = 'G' | 'Q' | 'S' | 'Sacc' | 'W';

export type CombinationKind = 'ELU' | 'ELU-ACC' | 'ELS';

export interface Combination {
  readonly id: string;
  /** Libellé imprimable, ex. « 1,35 G + 1,50 S + 0,90 W ». */
  readonly label: string;
  readonly kind: CombinationKind;
  /** Coefficient appliqué à chaque action ; absent ⇒ action non retenue. */
  readonly factors: Readonly<Partial<Record<ActionId, number>>>;
  /**
   * Sens du vent : +1 souffle vers les y croissants, −1 en sens inverse. Un
   * portique dissymétrique ne réagit pas de la même façon aux deux, et le pignon
   * au vent change de côté : on calcule les deux plutôt que de parier.
   */
  readonly windDirection: 1 | -1;
}

const fmt = (v: number): string => v.toFixed(2).replace('.', ',');

/**
 * Combinaisons à examiner.
 *
 * ELU (6.10) : une action variable dominante, les autres accompagnées de leur
 * ψ0. La combinaison de soulèvement `1,0 G + 1,5 W` est celle qui arrache les
 * pieds de poteaux et met les traverses en flexion inverse : l'oublier est
 * l'erreur classique du pré-dimensionnement, car toutes les autres sont
 * gravitaires et masquent le problème.
 *
 * ELS : combinaisons caractéristiques, sans coefficient partiel — les flèches se
 * vérifient sous charges de service.
 */
export function combinations(m: LoadModel): Combination[] {
  const { gammaG, gammaQ, psi0Neige, psi0Vent, psi0Exploitation } = m.factors;
  const l = m.loads;
  const avecQ = l.exploitation > 0;
  const avecS = l.neige > 0;
  const avecW = l.ventPression > 0 || l.ventDepression > 0;

  const out: Combination[] = [];
  const pousser = (
    kind: CombinationKind,
    factors: Partial<Record<ActionId, number>>,
    windDirection: 1 | -1 = 1,
  ): void => {
    const parts: string[] = [];
    for (const [a, v] of Object.entries(factors)) {
      if (v === undefined || v === 0) continue;
      parts.push(`${fmt(v)} ${a}${a === 'W' && windDirection < 0 ? '⁻' : ''}`);
    }
    const n = out.filter((c) => c.kind === kind).length + 1;
    out.push({
      id: `${kind}-${n}`,
      label: parts.join(' + '),
      kind,
      factors,
      windDirection,
    });
  };

  /* --- ELU --- */
  if (avecQ) pousser('ELU', { G: gammaG, Q: gammaQ });
  if (avecS) {
    pousser('ELU', {
      G: gammaG,
      S: gammaQ,
      ...(avecQ && psi0Exploitation > 0 ? { Q: gammaQ * psi0Exploitation } : {}),
      ...(avecW && psi0Vent > 0 ? { W: gammaQ * psi0Vent } : {}),
    });
  }
  if (avecW) {
    for (const sens of [1, -1] as const) {
      pousser(
        'ELU',
        {
          G: gammaG,
          W: gammaQ,
          ...(avecS && psi0Neige > 0 ? { S: gammaQ * psi0Neige } : {}),
        },
        sens,
      );
      // Soulèvement : le poids propre devient favorable, γG = 1,0.
      pousser('ELU', { G: 1, W: gammaQ }, sens);
    }
  }
  if (!avecQ && !avecS && !avecW) pousser('ELU', { G: gammaG });

  /* --- ELU accidentel : neige exceptionnelle --- */
  if (l.neigeAccidentelle > 0) pousser('ELU-ACC', { G: 1, Sacc: 1 });

  /* --- ELS caractéristiques --- */
  if (avecQ) pousser('ELS', { G: 1, Q: 1 });
  if (avecS) {
    pousser('ELS', {
      G: 1,
      S: 1,
      ...(avecW && psi0Vent > 0 ? { W: psi0Vent } : {}),
    });
  }
  if (avecW) {
    for (const sens of [1, -1] as const) {
      pousser(
        'ELS',
        { G: 1, W: 1, ...(avecS && psi0Neige > 0 ? { S: psi0Neige } : {}) },
        sens,
      );
    }
  }
  if (!avecQ && !avecS && !avecW) pousser('ELS', { G: 1 });

  return out;
}

/**
 * Intensité d'une action, en kN/m² de la surface sur laquelle elle est définie.
 *
 * ⚠ Les surfaces de référence diffèrent et les confondre fausse tout d'un
 * facteur cos α : le poids propre de couverture est donné par m² de RAMPANT, la
 * neige par m² de PROJECTION HORIZONTALE, le vent perpendiculairement à la paroi.
 */
export interface ActionIntensities {
  /** Poids propre de couverture, par m² de rampant. */
  readonly gToit: number;
  /** Exploitation, par m² de projection horizontale. */
  readonly qToit: number;
  /** Neige, par m² de projection horizontale. */
  readonly sToit: number;
  readonly sAccToit: number;
  /** Dépression de vent en toiture, perpendiculaire au rampant (soulèvement). */
  readonly wToit: number;
  /** Pression de vent sur la façade au vent, perpendiculaire à la paroi. */
  readonly wMur: number;
}

export function intensities(m: LoadModel, gSecondaire: number): ActionIntensities {
  const l = m.loads;
  return {
    // La couverture saisie, plus l'ossature secondaire que le modèle connaît :
    // l'utilisateur n'a pas à ressaisir un poids que le logiciel a déjà calculé.
    gToit: l.permanent + (m.loads.includeSelfWeight ? gSecondaire : 0),
    qToit: l.exploitation,
    sToit: l.neige,
    sAccToit: l.neigeAccidentelle,
    wToit: l.ventDepression,
    wMur: l.ventPression,
  };
}
