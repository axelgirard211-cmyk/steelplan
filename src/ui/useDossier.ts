import { useMemo } from 'react';
import type { StructuralModel } from '../core/build/types';
import { buildBom } from '../core/bom/index';
import type { ChecksReport } from '../core/checks/types';
import { buildSheets } from '../core/drawing/buildSheets';
import { indexDesTextes } from '../core/drawing/planchesDeLaPiece';
import type { RetouchesDePlanche } from '../core/drawing/retouches';
import type { Sheet } from '../core/drawing/sheet';
import type { ProjectParams } from '../core/model/project';
import { useChecksReport, useProjetEffectif, useStructuralModel } from '../state/derived';
import { useProjectStore } from '../state/store';

/**
 * LE DOSSIER DE PLANS GÉNÉRÉ, et les retouches du dessinateur.
 *
 * Un seul calcul pour l'onglet Plans, la page d'édition et le lien 3D → 2D :
 * deux dossiers construits chacun de leur côté finiraient par différer d'une
 * planche — et la centaine de planches coûte assez cher pour n'être tirée
 * qu'une fois par état du modèle.
 *
 * ⚠ Les retouches sont lues dans la SAISIE, pas dans le projet effectif : une
 * retouche ne régénère rien, elle se pose par-dessus.
 */

interface Cache {
  readonly model: StructuralModel;
  readonly project: ProjectParams;
  readonly checks: ChecksReport;
  readonly dossier: readonly Sheet[];
  readonly index: Map<string, Set<number>>;
}
let cache: Cache | null = null;

function dossierDe(model: StructuralModel, project: ProjectParams, checks: ChecksReport): Cache {
  if (cache && cache.model === model && cache.project === project && cache.checks === checks) return cache;
  const dossier = buildSheets(model, project, buildBom(project, model), checks);
  cache = { model, project, checks, dossier, index: indexDesTextes(dossier) };
  return cache;
}

export function useDossier(): {
  dossier: readonly Sheet[];
  index: ReadonlyMap<string, ReadonlySet<number>>;
  retouches: ReadonlyMap<string, RetouchesDePlanche>;
} {
  const model = useStructuralModel();
  const project = useProjetEffectif();
  const checks = useChecksReport();
  const { dossier, index } = dossierDe(model, project, checks);
  const liste = useProjectStore((s) => s.project.retouches);
  const retouches = useMemo(() => new Map(liste.map((x) => [x.planche, x])), [liste]);
  return { dossier, index, retouches };
}
