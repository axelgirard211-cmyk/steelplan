import { describe, expect, it } from 'vitest';
import { buildProject } from '../../core/build/buildProject';
import { runChecks } from '../../core/checks/index';
import { DEFAULT_PROJECT } from '../../core/model/defaults';
import type { ProjectParams } from '../../core/model/project';
import { resumerVerifications } from '../useEtatDuProjet';

/**
 * ⚠ La pastille de l'onglet Vérifications et le Parcours ne comptaient que les
 * taux au-delà de 1,00 : une ossature sous αcr = 3, dont aucun taux n'est une
 * vérification, y passait au vert dès que ses taux au premier ordre restaient
 * sous 1,00.
 */
describe('résumé des vérifications porté par les onglets', () => {
  const resume = (p: ProjectParams): ReturnType<typeof resumerVerifications> =>
    resumerVerifications(runChecks(p, buildProject(p)));

  it('signale une ossature hors domaine', () => {
    const ferme: ProjectParams = { ...DEFAULT_PROJECT, truss: { ...DEFAULT_PROJECT.truss, enabled: true } };
    expect(resume(ferme).horsDomaine).toBe(true);
  });

  it('ne signale rien sur une ossature dans le domaine', () => {
    const r = resume(DEFAULT_PROJECT);
    expect(r.horsDomaine).toBe(false);
    expect(r.enDefaut).toBe(0);
    expect(r.tauxMax).toBeGreaterThan(0);
  });
});
