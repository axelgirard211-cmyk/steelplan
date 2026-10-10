import { useMemo } from 'react';
import { buildBom } from '../core/bom/index';
import { buildSheets } from '../core/drawing/buildSheets';
import type { RetouchesDePlanche } from '../core/drawing/retouches';
import type { Sheet } from '../core/drawing/sheet';
import { useChecksReport, useProjetEffectif, useStructuralModel } from '../state/derived';
import { useProjectStore } from '../state/store';

/**
 * LE DOSSIER DE PLANS GÉNÉRÉ, et les retouches du dessinateur.
 *
 * Un seul calcul pour l'onglet Plans et la page d'édition : deux dossiers
 * construits chacun de leur côté finiraient par différer d'une planche.
 *
 * ⚠ Les retouches sont lues dans la SAISIE, pas dans le projet effectif : une
 * retouche ne régénère rien, elle se pose par-dessus.
 */
export function useDossier(): { dossier: readonly Sheet[]; retouches: ReadonlyMap<string, RetouchesDePlanche> } {
  const model = useStructuralModel();
  const project = useProjetEffectif();
  const checks = useChecksReport();
  const bom = useMemo(() => buildBom(project, model), [project, model]);
  const dossier = useMemo(() => buildSheets(model, project, bom, checks), [model, project, bom, checks]);
  const liste = useProjectStore((s) => s.project.retouches);
  const retouches = useMemo(() => new Map(liste.map((x) => [x.planche, x])), [liste]);
  return { dossier, retouches };
}
