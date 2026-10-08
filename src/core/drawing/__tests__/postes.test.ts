import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { buildBom } from '../../bom/index';
import { runChecks } from '../../checks/index';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import { buildSheets } from '../buildSheets';
import { destinataires, planchesDuPoste, POSTES, regleDe, sheetsBordereau } from '../postes';

const P = DEFAULT_PROJECT;
const M = buildProject(P);
const DOSSIER = buildSheets(M, P, buildBom(P, M), runChecks(P, M));
const textes = (s: (typeof DOSSIER)[number]): string[] =>
  s.scene.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));

describe('diffusion du dossier par poste', () => {
  it('route EXPLICITEMENT chaque planche du dossier', () => {
    /*
     * ⚠ Une planche que la table ne reconnaît pas part au seul bureau d'études :
     * c'est un repli, pas une règle. Toute planche du dossier par défaut doit
     * avoir sa ligne dans la table — sinon une nouvelle sorte de planche
     * n'arriverait jamais à l'atelier qui en a besoin.
     */
    const orphelines = DOSSIER.filter((s) => regleDe(s) === null).map((s) => s.id);
    expect(orphelines).toEqual([]);
  });

  it('remet à chaque poste d’atelier et de chantier un dossier non vide', () => {
    for (const poste of ['debit', 'percage', 'assemblage', 'montage', 'genie-civil', 'approvisionnement'] as const) {
      expect(planchesDuPoste(DOSSIER, poste).length, poste).toBeGreaterThan(0);
    }
  });

  it('donne les plans de pièce au débit et au perçage, les assemblages au soudeur', () => {
    const debit = planchesDuPoste(DOSSIER, 'debit').map((x) => x.sheet.kind);
    const assemblage = planchesDuPoste(DOSSIER, 'assemblage').map((x) => x.sheet.kind);
    expect(debit).toContain('debit');
    expect(debit).not.toContain('fabrication');
    expect(assemblage).toContain('fabrication');
    expect(assemblage).not.toContain('debit');
    // La note de calcul reste au bureau.
    for (const poste of POSTES.filter((x) => x.id !== 'bureau')) {
      expect(planchesDuPoste(DOSSIER, poste.id).some((x) => x.sheet.id.startsWith('note-')), poste.id).toBe(false);
    }
  });

  it('liste au bordereau toutes les planches du poste, sous leur numéro de dossier', () => {
    for (const { id } of POSTES) {
      const pages = sheetsBordereau(id, DOSSIER, P.meta);
      const t = pages.flatMap((b) => textes(b));
      // TOUTES les planches du poste, aucune tronquée.
      for (const { sheet, numero } of planchesDuPoste(DOSSIER, id)) {
        expect(t, `${id} : ${sheet.titre}`).toContain(sheet.titre);
        expect(t, `${id} : n° ${numero}`).toContain(String(numero));
      }
      for (const b of pages) expect(destinataires(b)).toEqual([id]);
      // Hors numérotation du dossier : le bordereau accompagne, il n'en fait pas partie.
      expect(t.some((x) => x.includes('§'))).toBe(false);
    }
  });

  it('liste aussi les quatre-vingt-dix planches d’un dossier de fermes, sans en tronquer une', () => {
    const t = TEMPLATES.find((x) => x.id === 'ferme-treillis')!.build();
    const m = buildProject(t);
    const dossier = buildSheets(m, t, buildBom(t, m), runChecks(t, m));
    const pages = sheetsBordereau('bureau', dossier, t.meta);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const lu = pages.flatMap((b) => textes(b));
    for (const { sheet } of planchesDuPoste(dossier, 'bureau')) expect(lu, sheet.titre).toContain(sheet.titre);
  });
});
