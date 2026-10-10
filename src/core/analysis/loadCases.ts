import type { CasVent } from '../climat/zonesVent';
import type { LoadModel } from '../model/loads';

/**
 * ACTIONS ET COMBINAISONS (EN 1990).
 *
 * Les valeurs des actions viennent du site (climat/) ou de la saisie. Ce module
 * en fait les COMBINAISONS — un travail purement arithmétique où l'erreur
 * humaine est fréquente et sans excuse —, avec les cas de vent par zones et les
 * répartitions de neige que chacune doit examiner.
 */

/** Actions élémentaires. */
export type ActionId = 'G' | 'Q' | 'S' | 'Sacc' | 'W';

export type CombinationKind = 'ELU' | 'ELU-ACC' | 'ELS';

/**
 * Répartition de la neige sur une toiture à deux versants, EN 1991-1-3
 * figure 5.3 : uniforme (i), ou réduite de moitié sur l'un des versants (ii,
 * iii). Un vent de travers balaie un versant : la dissymétrie fléchit le
 * portique là où la neige uniforme ne le fait pas.
 */
export type CasNeige = 'uniforme' | 'reduitGauche' | 'reduitDroite';

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
  /** Cas de vent par zones (site Eurocode) ; absent, le vent saisi en deux nombres. */
  readonly vent?: CasVent;
  /** Répartition de la neige ; absente, uniforme. */
  readonly neige?: CasNeige;
}

export interface OptionsCombinaisons {
  /** Cas de vent par zones. Absents : le vent saisi, dans les deux sens. */
  readonly vents?: readonly CasVent[];
  /** Répartitions de neige à examiner. Absentes : uniforme. */
  readonly neiges?: readonly CasNeige[];
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
 * Avec des cas de vent par zones, chacun est une action distincte : il entre
 * dominant avec 1,35 G (et la neige d'accompagnement), puis avec 1,0 G s'il
 * aspire la toiture. Une neige dominante est accompagnée des vents qui
 * POUSSENT la toiture — ceux qui l'aspirent la soulageraient.
 *
 * ELS : combinaisons caractéristiques, sans coefficient partiel — les flèches se
 * vérifient sous charges de service.
 */
export function combinations(m: LoadModel, options: OptionsCombinaisons = {}): Combination[] {
  const { gammaG, gammaQ, psi0Neige, psi0Vent, psi0Exploitation } = m.factors;
  const l = m.loads;
  const avecQ = l.exploitation > 0;
  const avecS = l.neige > 0;
  const avecW = l.ventPression > 0 || l.ventDepression > 0;
  const neiges: readonly CasNeige[] = options.neiges?.length ? options.neiges : ['uniforme'];
  const dissymetriques = neiges.filter((n) => n !== 'uniforme');

  interface Vent {
    readonly sens: 1 | -1;
    readonly cas?: CasVent;
  }
  const parZones = options.vents !== undefined && options.vents.length > 0;
  const vents: readonly Vent[] = parZones
    ? (options.vents ?? []).map((cas) => ({ sens: cas.incidence === 'travers' ? cas.sens : 1, cas }))
    : [{ sens: 1 }, { sens: -1 }];
  // Vents qui accompagnent une neige dominante. Saisi : le vent tel quel, dans
  // un sens — c'était la règle avant les zones et elle ne doit pas changer sous
  // un projet en saisie manuelle.
  const accompagnants: readonly Vent[] = parZones ? vents.filter((v) => v.cas?.versant === 'pression') : [{ sens: 1 }];

  const out: Combination[] = [];
  const pousser = (
    kind: CombinationKind,
    factors: Partial<Record<ActionId, number>>,
    vent: Vent = { sens: 1 },
    neige: CasNeige = 'uniforme',
  ): void => {
    const parts: string[] = [];
    for (const [a, v] of Object.entries(factors)) {
      if (v === undefined || v === 0) continue;
      if (a === 'W') parts.push(`${fmt(v)} W${vent.cas ? ` (${vent.cas.court})` : vent.sens < 0 ? '⁻' : ''}`);
      else if (a === 'S' && neige !== 'uniforme') parts.push(`${fmt(v)} S (½ ${neige === 'reduitGauche' ? 'à gauche' : 'à droite'})`);
      else parts.push(`${fmt(v)} ${a}`);
    }
    const n = out.filter((c) => c.kind === kind).length + 1;
    out.push({
      id: `${kind}-${n}`,
      label: parts.join(' + '),
      kind,
      factors,
      windDirection: vent.sens,
      ...(vent.cas ? { vent: vent.cas } : {}),
      ...(neige !== 'uniforme' && factors.S ? { neige } : {}),
    });
  };
  const psiQ = avecQ && psi0Exploitation > 0 ? { Q: gammaQ * psi0Exploitation } : {};

  /* --- ELU --- */
  if (avecQ) pousser('ELU', { G: gammaG, Q: gammaQ });
  if (avecS) {
    if (parZones) pousser('ELU', { G: gammaG, S: gammaQ, ...psiQ });
    const ventsS = avecW && psi0Vent > 0 ? accompagnants : [];
    for (const v of ventsS) pousser('ELU', { G: gammaG, S: gammaQ, ...psiQ, W: gammaQ * psi0Vent }, v);
    if (ventsS.length === 0 && !parZones) pousser('ELU', { G: gammaG, S: gammaQ, ...psiQ });
    for (const n of dissymetriques) pousser('ELU', { G: gammaG, S: gammaQ, ...psiQ }, undefined, n);
  }
  if (avecW) {
    for (const v of vents) {
      pousser('ELU', { G: gammaG, W: gammaQ, ...(avecS && psi0Neige > 0 ? { S: gammaQ * psi0Neige } : {}) }, v);
      // Soulèvement : le poids propre devient favorable, γG = 1,0. Un vent qui
      // pousse la toiture n'en produit pas.
      if (v.cas?.versant !== 'pression') pousser('ELU', { G: 1, W: gammaQ }, v);
    }
  }
  if (!avecQ && !avecS && !avecW) pousser('ELU', { G: gammaG });

  /* --- ELU accidentel : neige exceptionnelle --- */
  if (l.neigeAccidentelle > 0) pousser('ELU-ACC', { G: 1, Sacc: 1 });

  /* --- ELS caractéristiques --- */
  if (avecQ) pousser('ELS', { G: 1, Q: 1 });
  if (avecS) {
    pousser('ELS', { G: 1, S: 1, ...(!parZones && avecW && psi0Vent > 0 ? { W: psi0Vent } : {}) });
    for (const n of dissymetriques) pousser('ELS', { G: 1, S: 1 }, undefined, n);
  }
  if (avecW) {
    for (const v of vents) pousser('ELS', { G: 1, W: 1, ...(avecS && psi0Neige > 0 ? { S: psi0Neige } : {}) }, v);
  }
  if (!avecQ && !avecS && !avecW) pousser('ELS', { G: 1 });

  return out;
}

/**
 * Combinaisons qui comptent pour l'ossature SECONDAIRE.
 *
 * Pannes et lisses reçoivent le vent par une valeur enveloppe, pas par le
 * zonage du portique, et la neige dissymétrique n'aggrave aucune panne — elle
 * en décharge la moitié. Les cas de vent qui ne diffèrent que par leur zonage
 * donneraient donc des calculs identiques : on n'en garde qu'un.
 */
export function combinaisonsSecondaires(combs: readonly Combination[]): Combination[] {
  const vues = new Set<string>();
  return combs.filter((c) => {
    if (c.neige) return false;
    const cle = `${c.kind}|${Object.entries(c.factors)
      .map(([a, v]) => `${a}${v}`)
      .join(',')}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
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
  /**
   * Pression dynamique de pointe qp (kN/m²), quand le vent est appliqué par
   * zones : chaque paroi reçoit alors qp × son coefficient net, et `wToit`,
   * `wMur` ne servent plus qu'à l'ossature secondaire. Nulle en saisie manuelle.
   */
  readonly qp: number;
}

export function intensities(m: LoadModel, gSecondaire: number, qp = 0): ActionIntensities {
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
    qp,
  };
}
