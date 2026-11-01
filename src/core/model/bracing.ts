import type { SteelGradeId } from '../catalog/types';
import { buildingLength } from './grid';
import type { ProjectParams } from './project';

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
  // Dédoublonnées et entières : une travée citée deux fois ne porte pas deux croix.
  if (set.bays.length > 0) return [...new Set(set.bays)].filter((b) => Number.isInteger(b) && b >= 0 && b < nBays);
  return nBays <= 1 ? [0] : [0, nBays - 1];
}

/**
 * Défauts d'une liste de travées saisie, un message par défaut distinct :
 * indice fractionnaire, répété, ou hors du bâtiment (`nBays` nul : trame
 * elle-même invalide, l'étendue n'est pas contrôlée).
 *
 * ⚠ Un indice fractionnaire ou répété passait : 20 000 fois la travée 0
 * multipliait les diagonales sans qu'aucun plafond ne le voie.
 */
export function defautsDesTravees(bays: readonly number[], nBays: number | null): string[] {
  const out = new Set<string>();
  const vues = new Set<number>();
  for (const b of bays) {
    if (!Number.isInteger(b)) out.add(`Indice de travée ${b} non entier.`);
    else if (vues.has(b)) out.add(`Travée ${b} sélectionnée plusieurs fois.`);
    else {
      vues.add(b);
      if (nBays !== null && (b < 0 || b >= nBays)) out.add(`Travée ${b} inexistante (le bâtiment en compte ${nBays}).`);
    }
  }
  return [...out];
}

/** Dilatation d'une ossature acier : α ≈ 12·10⁻⁶ /K (EN 1993-1-1 §3.2.6). */
const ALPHA_ACIER = 12e-6;
/** Écart de température retenu pour donner un ORDRE DE GRANDEUR du mouvement (K). */
const ECART_INDICATIF = 30;
/** Longueur au-delà de laquelle la SCI (P070) recommande un joint de dilatation. */
const LONGUEUR_SANS_JOINT = 100_000;
/** Distance entre palées d'extrémité à partir de laquelle SteelPlan le signale (repère indicatif). */
const PALEES_ELOIGNEES = 60_000;

/**
 * ⚠ BÂTIMENT LONG. Un hangar de 120 m sortait avec ses deux seules palées
 * d'extrémité, sans un mot : rien ne disait ni qu'un joint de dilatation est
 * d'usage à cette longueur, ni que deux palées aux pignons BRIDENT la file entre
 * elles. Une palée centrale laisse au contraire le bâtiment se dilater vers les
 * deux pignons. SteelPlan ne modélise ni joint ni action thermique : il le dit.
 */
export function dilatation(p: ProjectParams, warn: (path: string, message: string) => void): void {
  const g = p.grid;
  const L = buildingLength(g);
  const m = (v: number): string => (v / 1000).toFixed(0);
  if (L > LONGUEUR_SANS_JOINT) {
    warn(
      'grid.nBays',
      `Bâtiment de ${m(L)} m d’un seul tenant : au-delà d’environ 100 m, l’usage est de le recouper par un joint de dilatation (SCI P070), ou de justifier les actions thermiques (EN 1991-1-5). SteelPlan ne modélise ni joint ni effet thermique.`,
    );
  }
  const palees = bracedBays(p.bracing.wall, g.nBays);
  if (palees.length < 2) return;
  const x = (b: number): number => (b + 0.5) * g.baySpacing;
  const premiere = Math.min(...palees);
  const derniere = Math.max(...palees);
  const ecart = x(derniere) - x(premiere);
  const auCentre = palees.some((b) => x(b) > L / 3 && x(b) < (2 * L) / 3);
  if (ecart > PALEES_ELOIGNEES && !auCentre) {
    const bride = ALPHA_ACIER * ecart * ECART_INDICATIF;
    const centrale = Math.floor(g.nBays / 2) + 1;
    warn(
      'bracing.wall.bays',
      `Palées de stabilité distantes de ${m(ecart)} m, aucune en partie centrale : la dilatation de la file est bridée entre elles (≈ ${bride.toFixed(0)} mm pour ${ECART_INDICATIF} K d’écart). Une palée en travée centrale (travée ${centrale}) laisse le bâtiment se dilater vers les pignons ; sinon, justifier les efforts thermiques dans les sablières et les palées.`,
    );
  }
}

