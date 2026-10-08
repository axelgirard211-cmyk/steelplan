import type { SteelGradeId } from '../catalog/types';
import type { StructuralModel } from '../build/types';
import { designationSoudure, longueurDeposee, volumeDepose } from '../geometry/weld';
import { footprintArea, roofArea } from '../model/grid';
import type { ProjectParams } from '../model/project';
import type { BoltLine } from './boulonnerie';
import type { DebitLine, ToleLine } from './debit';

/**
 * SYNTHÈSE DU PROJET.
 *
 * Les grandeurs qu'on lit en premier sur un devis : le tonnage, sa répartition
 * par nuance, la surface à traiter, la quantité de boulonnerie et de soudure. Ce
 * sont des sommes, pas des calculs : toute valeur vient d'une ligne de
 * nomenclature, qui vient elle-même du modèle.
 */
export interface ProjectTotals {
  /** Masse d'acier de charpente : barres, jarrets et tôles (kg). */
  readonly massSteel: number;
  readonly massMembers: number;
  readonly massPlates: number;
  readonly massBolts: number;
  /** Masse totale à livrer, boulonnerie comprise (kg). */
  readonly massTotal: number;
  readonly massByGrade: Readonly<Partial<Record<SteelGradeId, number>>>;

  /** Surface développée à peindre ou à galvaniser (m²). */
  readonly paintM2: number;
  /** Emprise au sol et toiture développée (m²). */
  readonly footprintM2: number;
  readonly roofM2: number;
  /** Ratio de charpente, l'indicateur que tout le monde regarde (kg/m²). */
  readonly kgPerM2: number;

  readonly pieceCount: number;
  readonly markCount: number;
  readonly boltCount: number;
  readonly weldMetres: number;
  /** Métal d'apport à déposer (kg). */
  readonly weldMassKg: number;
}

export function projectTotals(
  p: ProjectParams,
  model: StructuralModel,
  debit: readonly DebitLine[],
  toles: readonly ToleLine[],
  bolts: readonly BoltLine[],
): ProjectTotals {
  const massMembers = debit.reduce((s, l) => s + l.massTotal, 0);
  const massPlates = toles.reduce((s, l) => s + l.massTotal, 0);
  const massBolts = bolts.reduce((s, l) => s + l.massTotal, 0);
  const massSteel = massMembers + massPlates;

  const massByGrade: Partial<Record<SteelGradeId, number>> = {};
  for (const l of [...debit, ...toles]) {
    massByGrade[l.grade] = (massByGrade[l.grade] ?? 0) + l.massTotal;
  }

  const footprintM2 = footprintArea(p.grid);
  const paintM2 = debit.reduce((s, l) => s + l.paintM2, 0);

  // Métal d'apport : la section d'un cordon d'angle vaut environ le carré de sa
  // gorge, ce qui suffit à estimer la consommation de fil.
  const weldMassKg = model.welds.reduce((s, w) => s + volumeDepose(w), 0) * 7.85e-6;

  return {
    massSteel,
    massMembers,
    massPlates,
    massBolts,
    massTotal: massSteel + massBolts,
    massByGrade,
    paintM2,
    footprintM2,
    roofM2: roofArea(p.grid),
    kgPerM2: footprintM2 > 0 ? massSteel / footprintM2 : 0,
    pieceCount:
      debit.reduce((s, l) => s + l.quantity, 0) + toles.reduce((s, l) => s + l.quantity, 0),
    markCount: debit.length + toles.length,
    // Les écrous de liernes ne sont pas des boulons posés.
    boltCount: bolts.reduce((s, l) => s + (l.piece === 'ecrou' ? 0 : l.count), 0),
    weldMetres: model.stats.weldMetres,
    weldMassKg,
  };
}

/** Nomenclature de soudure : les cordons regroupés par désignation. */
export interface WeldLine {
  readonly designation: string;
  readonly count: number;
  readonly metres: number;
  readonly note: string;
}

export function weldList(model: StructuralModel): WeldLine[] {
  const lignes = new Map<string, WeldLine>();
  for (const w of model.welds) {
    const designation = designationSoudure(w);
    const existant = lignes.get(designation);
    lignes.set(designation, {
      designation,
      count: (existant?.count ?? 0) + 1,
      metres: (existant?.metres ?? 0) + longueurDeposee(w) / 1000,
      note: existant?.note ?? w.note,
    });
  }
  return [...lignes.values()].sort((a, b) => b.metres - a.metres);
}
