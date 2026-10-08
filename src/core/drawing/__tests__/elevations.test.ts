import { describe, expect, it } from 'vitest';
import { buildProject } from '../../build/buildProject';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { TEMPLATES } from '../../model/templates';
import type { ProjectParams } from '../../model/project';
import { FORMATS } from '../layout';
import type { DrawEntity } from '../scene';
import type { Sheet } from '../sheet';
import { sheetElevations } from '../sheets/elevations';

const OPTS = { page: 1, total: 60, meta: DEFAULT_PROJECT.meta };

function planche(p: ProjectParams = DEFAULT_PROJECT): Sheet {
  return sheetElevations(buildProject(p), p, { ...OPTS, meta: p.meta });
}

function textes(s: Sheet): string[] {
  return s.scene.entities
    .filter((e): e is Extract<DrawEntity, { kind: 'texte' }> => e.kind === 'texte')
    .map((e) => e.texte);
}

describe('planche d’élévation', () => {
  const S = planche();

  it('porte les QUATRE faces sur une seule feuille', () => {
    const t = textes(S);
    expect(t.filter((x) => x.startsWith('Élévation file'))).toHaveLength(4);
  });

  it('nomme les vues PAR FILE, chiffres en travers et lettres en long', () => {
    /*
     * ⚠ « Élévation file 1 » se retrouve sur le plan sans savoir où est l'ouest ;
     * « façade pignon ouest » suppose une orientation que le lecteur n'a pas
     * forcément en tête. C'est la convention des bureaux d'études, et elle relie
     * la vue aux bulles de file tracées à son pied.
     */
    const t = textes(S);
    expect(t).toContain('Élévation file A — éch. 1/100');
    expect(t).toContain('Élévation file B — éch. 1/100');
    expect(t.some((x) => /^Élévation file \d+ — éch/.test(x))).toBe(true);
  });

  it('dessine TOUTES les vues à la MÊME échelle', () => {
    /*
     * ⚠ Cadrer chaque vue au mieux de sa case donnerait un pignon deux fois plus
     * grand qu'un long pan : deux hauteurs d'égout identiques n'auraient pas la
     * même longueur sur le papier, et la comparaison que fait l'œil sans y penser
     * deviendrait fausse.
     */
    const echelles = new Set(
      textes(S)
        .filter((x) => x.startsWith('Élévation file'))
        .map((x) => x.split('éch. ')[1]),
    );
    expect(echelles.size).toBe(1);
    expect([...echelles][0]).toBe(`1/${S.echelle}`);
  });

  it('pose une bulle de file sous chaque vue', () => {
    // Les bulles sont ce par quoi le chantier situe une pièce : « le poteau de
    // la file 3 », jamais « le poteau à 12 mètres du bord ».
    const cercles = S.scene.entities.filter(
      (e) => e.kind === 'cercle' && e.layer === 'reperage',
    );
    // Deux pignons × 2 files + deux long pans × (nBays + 1) files.
    const attendu = 2 * 2 + 2 * (DEFAULT_PROJECT.grid.nBays + 1);
    expect(cercles.length).toBeGreaterThanOrEqual(attendu);
  });

  it('tient dans le cadre de la feuille', () => {
    /*
     * ⚠ Une vue qui déborde du cadre est perdue à l'impression, et rien dans le
     * modèle ne le signale : le tracé reste valide, la géométrie juste, seule la
     * feuille est trop petite. C'est le défaut que la mise en page par fractions
     * fixes rendait possible dès qu'un bâtiment sortait des proportions
     * courantes.
     */
    const f = FORMATS[S.format];
    for (const e of S.scene.entities) {
      const pts =
        e.kind === 'ligne'
          ? [e.a, e.b]
          : e.kind === 'polyligne'
            ? e.points
            : e.kind === 'texte'
              ? [e.at]
              : e.kind === 'cercle'
                ? [e.c]
                : [];
      for (const q of pts) {
        if (!q) continue;
        expect(q.x, `${e.kind} hors cadre en x`).toBeGreaterThanOrEqual(-1);
        expect(q.x, `${e.kind} hors cadre en x`).toBeLessThanOrEqual(f.largeur + 1);
        expect(q.y, `${e.kind} hors cadre en y`).toBeGreaterThanOrEqual(-1);
        expect(q.y, `${e.kind} hors cadre en y`).toBeLessThanOrEqual(f.hauteur + 1);
      }
    }
  });

  it('tient sur tous les gabarits, à une échelle normalisée', () => {
    const NORMALISEES = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const [nom, gabarit] of Object.entries(TEMPLATES)) {
      const s = planche(gabarit.build());
      expect(NORMALISEES, nom).toContain(s.echelle);
      expect(textes(s).filter((x) => x.startsWith('Élévation file')), nom).toHaveLength(4);
    }
  });
});
