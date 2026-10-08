import { getGrade } from '../../catalog/index';
import type { SteelGradeId } from '../../catalog/types';
import type { BoltSpec } from '../../model/connections';
import { ftRd } from '../boulons';
import { GAMMA_M0 } from '../section';

/**
 * TRONÇON EN T ÉQUIVALENT — EN 1993-1-8 § 6.2.4.
 *
 * ⚠ C'est le cœur du calcul d'une platine d'about, et l'erreur la plus commune
 * est de l'omettre : on compte les boulons, on multiplie par leur résistance à
 * la traction, et on annonce un moment résistant deux fois trop grand. Une
 * platine de 15 mm ne développe PAS la résistance de ses boulons M24 — elle plie
 * d'abord, et la plastification de la tôle libère le boulon avant qu'il ne casse.
 *
 * Les trois modes de ruine sont examinés, et c'est le plus faible qui compte :
 *  1. plastification complète de la platine, les boulons intacts ;
 *  2. ruine des boulons AVEC plastification de la platine ;
 *  3. ruine des boulons seuls, platine rigide.
 *
 * Omettre le mode 2 — l'intermédiaire, le moins intuitif — est l'autre erreur
 * classique : il gouverne précisément dans la zone où platine et boulons sont
 * équilibrés, c'est-à-dire dans tout dimensionnement bien fait.
 */

export interface GeometrieTroncon {
  /** Longueur efficace de la ligne de plastification (mm). */
  readonly leff: number;
  /** Épaisseur de la platine (mm). */
  readonly tp: number;
  /** Distance de l'axe du boulon à la face de l'âme, congé déduit (mm). */
  readonly m: number;
  /** Distance de l'axe du boulon au bord libre de la platine (mm). */
  readonly e: number;
  /** Nombre de boulons de la rangée (en général 2). */
  readonly nBoulons: number;
}

export interface ResistanceTroncon {
  readonly ftRd: number;
  /** Mode gouvernant, tel qu'il s'écrit au rapport. */
  readonly mode: 'platine' | 'mixte' | 'boulons';
}

export function troncon(
  g: GeometrieTroncon,
  boulon: BoltSpec,
  nuance: SteelGradeId,
): ResistanceTroncon {
  const fy = getGrade(nuance).fy;
  const somme = g.nBoulons * ftRd(boulon);

  /*
   * ⚠ Une géométrie dégénérée — boulon dans l'âme, platine d'épaisseur nulle —
   * donnerait des résistances infinies par division par zéro. Elle ne peut pas
   * se produire sur un projet valide, mais un dimensionnement automatique
   * explore des configurations que personne n'aurait dessinées.
   */
  if (g.m <= 0 || g.leff <= 0 || g.tp <= 0) {
    return { ftRd: somme, mode: 'boulons' };
  }

  // Moment plastique de la ligne de plastification (N·mm).
  const mpl = (0.25 * g.leff * g.tp * g.tp * fy) / GAMMA_M0;

  // Mode 1 : la platine plastifie sur ses deux lignes, les boulons tiennent.
  const mode1 = (4 * mpl) / g.m;

  // Mode 2 : plastification côté âme, ruine des boulons côté bord.
  // n est le bras de levier de l'effet de levier, plafonné à 1,25 m.
  const n = Math.min(g.e, 1.25 * g.m);
  const mode2 = (2 * mpl + n * somme) / (g.m + n);

  // Mode 3 : la platine est assez épaisse pour ne pas plier.
  const mode3 = somme;

  const min = Math.min(mode1, mode2, mode3);
  return {
    ftRd: min,
    mode: min === mode1 ? 'platine' : min === mode2 ? 'mixte' : 'boulons',
  };
}

/**
 * Longueur efficace d'une rangée, la plus petite des lignes de plastification
 * possibles (EN 1993-1-8 tableau 6.6).
 *
 * `pas` est la distance à la rangée voisine ; l'omettre traite la rangée comme
 * isolée, ce qui est le cas favorable — donc à ne faire que pour une rangée
 * réellement seule.
 */
export function longueurEfficace(m: number, e: number, pas?: number): number {
  // Schéma circulaire : la platine plastifie tout autour du boulon.
  const circulaire = 2 * Math.PI * m;
  // Schéma non circulaire : la ligne rejoint le bord libre.
  const nonCirculaire = 4 * m + 1.25 * e;
  const candidats = [circulaire, nonCirculaire];
  /*
   * ⚠ Deux rangées voisines ne peuvent pas développer chacune sa propre ligne de
   * plastification si elles sont trop rapprochées : elles se partagent la tôle.
   * La longueur disponible par rangée se limite alors à leur entraxe.
   */
  if (pas !== undefined && pas > 0) candidats.push(pas);
  return Math.min(...candidats);
}
