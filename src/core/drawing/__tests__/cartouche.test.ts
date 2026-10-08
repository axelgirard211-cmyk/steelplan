import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT } from '../../model/defaults';
import { dessinerCadre, fenetreDe } from '../layout';
import { DrawScene } from '../scene';

/* ================================================================== */
/* Tableau des indices du cartouche                                    */
/* ================================================================== */

describe('tableau des indices', () => {
  const meta = {
    ...DEFAULT_PROJECT.meta,
    indice: 'H',
    revisions: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((indice, k) => ({
      indice,
      date: `2026-0${(k % 9) + 1}-01`,
      objet: `Modification ${indice}`,
      auteur: 'LM',
    })),
  };
  const s = new DrawScene();
  dessinerCadre(s, 'A3', { meta, titre: 'Essai', echelle: 100, page: 1, total: 1 });
  const textes = s.entities.flatMap((e) => (e.kind === 'texte' ? [e] : []));
  const yDe = (t: string): number | undefined => textes.find((e) => e.texte === t)?.at.y;

  it('porte les CINQ dernières diffusions, pas les plus anciennes', () => {
    for (const i of ['D', 'E', 'F', 'G', 'H']) expect(yDe(`Modification ${i}`), i).toBeDefined();
    for (const i of ['A', 'B', 'C']) expect(yDe(`Modification ${i}`), i).toBeUndefined();
  });

  it('pose la plus RÉCENTE en haut, au-dessus des précédentes', () => {
    // Une nouvelle diffusion s'ajoute au-dessus, sans déplacer celles déjà lues.
    expect(yDe('Modification H')!).toBeGreaterThan(yDe('Modification G')!);
    expect(yDe('Modification G')!).toBeGreaterThan(yDe('Modification D')!);
  });

  it('reste dans la bande basse, sans mordre sur la fenêtre de dessin', () => {
    /*
     * ⚠ Le tableau occupe la bande que la fenêtre de dessin laisse vide : il ne
     * doit pas dépasser la hauteur du cartouche, sans quoi il recouvrirait le
     * coin bas-droit de chaque vue, là où tombent les cotations.
     */
    const plafond = fenetreDe('A3').min.y;
    for (const e of textes.filter((t) => /^Modification /.test(t.texte))) {
      expect(e.at.y).toBeLessThan(plafond);
    }
  });

  it('se contente de l’indice du cartouche quand aucune diffusion n’est inscrite', () => {
    const vide = new DrawScene();
    dessinerCadre(vide, 'A3', {
      meta: { ...DEFAULT_PROJECT.meta, revisions: [] },
      titre: 'Essai',
      echelle: 100,
      page: 1,
      total: 1,
    });
    const t = vide.entities.flatMap((e) => (e.kind === 'texte' ? [e.texte] : []));
    expect(t).toContain('OBJET DE LA MODIFICATION');
    // Rien d'inventé : pas d'« édition originale » que personne n'a écrite.
    expect(t.some((x) => /originale|première diffusion/i.test(x))).toBe(false);
  });
});
