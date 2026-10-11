import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { SITE_PAR_DEFAUT } from '../../model/site';
import { getTemplate } from '../../model/templates';
import { isValid, validateProject } from '../../model/validate';
import { dimensionner } from '../dimensionner';
import { dimensionnerAssemblages } from '../dimensionnerAssemblages';
import { runChecks } from '../index';

/**
 * DIMENSIONNEMENT DES ASSEMBLAGES.
 *
 * ⚠ Le cas de départ est RÉEL : le bâtiment industriel, profils dimensionnés,
 * sortait avec ses pieds de poteaux à 1,51 et ses attaches de contreventement à
 * 1,42 sous un site Eurocode courant — et le dimensionnement se disait fini.
 */

const eurocode = (p: ProjectParams): ProjectParams => ({ ...p, site: { ...SITE_PAR_DEFAUT, mode: 'eurocode' } });

describe('réglage des assemblages', () => {
  const industriel = dimensionner(eurocode((getTemplate('batiment-industriel') as { build: () => ProjectParams }).build())).projet;
  const avant = runChecks(industriel, buildProject(industriel)).assemblages;
  const r = dimensionnerAssemblages(industriel);
  const apres = runChecks(r.projet, buildProject(r.projet)).assemblages;

  it('fait passer sous 1,00 les assemblages que les profils seuls laissaient en défaut', () => {
    expect(avant.some((a) => a.ratio > 1)).toBe(true);
    expect(apres.filter((a) => a.ratio > 1).map((a) => `${a.libelle} ${a.ratio.toFixed(2)}`)).toEqual([]);
    expect(r.insolubles).toEqual([]);
    expect(r.tauxMax).toBeLessThanOrEqual(1);
  });

  it('agit sur le réglage du mode de ruine, et dit ce qu’il a changé', () => {
    // Pied : la platine qui plie s'épaissit.
    const pied = r.reglages.find((x) => x.reglage === 'épaisseur de la platine de pied');
    expect(pied).toBeDefined();
    expect(r.projet.connections.columnBase.thickness).toBeGreaterThan(industriel.connections.columnBase.thickness);
    for (const x of r.reglages) {
      expect(x.avant).not.toBe(x.apres);
      expect(x.tauxApres).toBeLessThan(x.tauxAvant);
      expect(x.assemblages.length).toBeGreaterThan(0);
    }
  });

  it('rend un projet valide, dont les barres restent vérifiées', () => {
    expect(isValid(validateProject(r.projet))).toBe(true);
    expect(runChecks(r.projet, buildProject(r.projet)).maxRatio).toBeLessThanOrEqual(1);
  });

  it('ne touche à rien quand tout passe', () => {
    const p = dimensionner(DEFAULT_PROJECT).projet;
    const rien = dimensionnerAssemblages(p);
    expect(rien.reglages).toEqual([]);
    expect(rien.projet).toBe(p);
    expect(rien.evaluations).toBe(1);
  });

  it('nomme l’assemblage qu’aucun réglage ne corrige, avec la voie à suivre', () => {
    /*
     * Le cordon de semelle du genou : sa gorge suit l'épaisseur de la semelle de
     * la traverse, aucun réglage de platine ne l'augmente. Le dire vaut mieux
     * que d'épaissir la platine pour rien.
     */
    const p = eurocode(DEFAULT_PROJECT);
    const genou = runChecks(p, buildProject(p)).assemblages.find((a) => a.id === 'genou');
    expect(genou?.ratio).toBeGreaterThan(1);
    expect(genou?.gouverne).toMatch(/^cordon/);
    const i = dimensionnerAssemblages(p).insolubles.find((x) => x.assemblage === genou?.libelle);
    expect(i?.conseil).toMatch(/pleine pénétration/);
  });

  it('se demande au dimensionnement automatique', () => {
    const prop = dimensionner(eurocode((getTemplate('batiment-industriel') as { build: () => ProjectParams }).build()), { assemblages: true });
    expect(prop.assemblages?.reglages.length).toBeGreaterThan(0);
    expect(prop.assemblages?.tauxMax).toBeLessThanOrEqual(1);
    expect(prop.projet.connections.columnBase.thickness).toBe(r.projet.connections.columnBase.thickness);
  });
});
