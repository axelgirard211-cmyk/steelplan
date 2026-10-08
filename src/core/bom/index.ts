import { plateMassKg } from '../build/buildProject';
import type { StructuralModel } from '../build/types';
import type { ProjectParams } from '../model/project';
import { boltList, type BoltLine } from './boulonnerie';
import { debitList, toleList, type DebitLine, type ToleLine } from './debit';
import { projectTotals, weldList, type ProjectTotals, type WeldLine } from './totals';

/**
 * NOMENCLATURES du projet, en un seul objet.
 *
 * Comme le modèle et le dossier de plans, c'est une fonction pure : rien n'est
 * stocké, tout est reconstruit. Une nomenclature qu'on « régénère » à la main
 * finit toujours par ne plus correspondre aux plans qu'elle accompagne.
 */
export interface Bom {
  readonly debit: readonly DebitLine[];
  readonly toles: readonly ToleLine[];
  readonly bolts: readonly BoltLine[];
  readonly welds: readonly WeldLine[];
  readonly totals: ProjectTotals;
}

export function buildBom(p: ProjectParams, model: StructuralModel): Bom {
  const debit = debitList(model);
  const toles = toleList(model, plateMassKg);
  const bolts = boltList(p, model);
  const welds = weldList(model);
  return {
    debit,
    toles,
    bolts,
    welds,
    totals: projectTotals(p, model, debit, toles, bolts),
  };
}

export type { BoltLine, DebitLine, ProjectTotals, ToleLine, WeldLine };
export { boltLength, boltMass } from './boulonnerie';
export {
  boulonnerieToCsv,
  chiffrageToCsv,
  colisageToCsv,
  debitToCsv,
  souduresToCsv,
  tolesToCsv,
  totauxToCsv,
} from './csv';
