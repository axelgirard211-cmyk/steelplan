import { describe, expect, it } from 'vitest';
import { elementsEditables, retouchesVides, ajouter } from '../../core/drawing/retouches';
import { DrawScene, pt } from '../../core/drawing/scene';
import type { Sheet } from '../../core/drawing/sheet';
import { appliquerActions } from '../editeur/actions';

const s = new DrawScene().ligne(pt(0, 0), pt(10, 0), 'contour');
const SHEET: Sheet = { id: 'essai', kind: 'detail', titre: 'Essai', format: 'A3', echelle: 10, scene: s };

describe('application des actions aux retouches', () => {
  it('remplace une entité générée par ses morceaux, en gardant son origine', () => {
    const el = elementsEditables(SHEET, undefined);
    const cle = `g:${(el[0]?.ref as { cle: string }).cle}`;
    const { retouches, vider } = appliquerActions(
      retouchesVides('essai'),
      [{ type: 'remplacer', cle, par: [{ kind: 'ligne', a: pt(0, 0), b: pt(3, 0), layer: 'contour' }, { kind: 'ligne', a: pt(7, 0), b: pt(10, 0), layer: 'contour' }], libelle: 'Ajuster' }],
      [],
      el,
    );
    expect(retouches.masques).toHaveLength(1);
    expect(retouches.ajouts).toHaveLength(2);
    expect(retouches.ajouts[0]?.origine).toBe(retouches.masques[0]);
    expect(vider).toBe(true);
  });

  it('efface une entité remplacée par rien', () => {
    const r0 = ajouter(retouchesVides('essai'), [{ kind: 'cercle', c: pt(5, 5), r: 1, layer: 'contour' }], () => 'x1');
    const el = elementsEditables(SHEET, r0);
    const { retouches } = appliquerActions(r0, [{ type: 'remplacer', cle: 'a:x1', par: [], libelle: 'Ajuster' }], [], el);
    expect(retouches.ajouts).toHaveLength(0);
  });
});
