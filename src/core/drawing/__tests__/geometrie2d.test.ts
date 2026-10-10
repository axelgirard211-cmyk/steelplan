import { describe, expect, it } from 'vitest';
import {
  accrocher,
  contenuDans,
  distanceA,
  homothetie,
  ortho,
  rotationAutour,
  symetrie,
  toucheLaFenetre,
  transformer,
  translation,
} from '../geometrie2d';
import type { EntiteDessin } from '../retouches';
import { pt, type DrawEntity } from '../scene';

const ligne = (x0: number, y0: number, x1: number, y1: number): DrawEntity => ({ kind: 'ligne', a: pt(x0, y0), b: pt(x1, y1), layer: 'contour' });
const proche = (a: number, b: number): void => expect(a).toBeCloseTo(b, 6);

describe('transformations', () => {
  it('déplace, tourne et met à l’échelle', () => {
    const l = transformer(ligne(0, 0, 10, 0), translation(5, 5)) as Extract<DrawEntity, { kind: 'ligne' }>;
    expect(l.a).toEqual(pt(5, 5));
    const r = transformer(ligne(0, 0, 10, 0), rotationAutour(pt(0, 0), Math.PI / 2)) as Extract<DrawEntity, { kind: 'ligne' }>;
    proche(r.b.x, 0);
    proche(r.b.y, 10);
    const c = transformer({ kind: 'cercle', c: pt(10, 0), r: 2, layer: 'contour' }, homothetie(pt(0, 0), 3));
    expect(c).toMatchObject({ c: { x: 30, y: 0 }, r: 6 });
  });

  it('tourne un texte avec la sélection, mais ne le retourne pas en miroir', () => {
    // ⚠ Un texte symétrisé serait illisible : seul son point suit le miroir.
    const t: EntiteDessin = { kind: 'texte', at: pt(10, 5), texte: 'TR1', hauteur: 2.5, ancrage: 'gauche', ligneDeBase: 'bas', rotation: 0, gras: false, layer: 'texte' };
    expect(transformer(t, rotationAutour(pt(0, 0), Math.PI / 2))).toMatchObject({ rotation: 90 });
    const m = transformer(t, symetrie(pt(0, 0), pt(0, 10)));
    expect(m).toMatchObject({ at: { x: -10, y: 5 }, rotation: 0 });
    expect(transformer(t, homothetie(pt(0, 0), 2))).toMatchObject({ hauteur: 5 });
  });

  it('inverse le sens d’un arc en miroir, sans changer son balayage', () => {
    const a: EntiteDessin = { kind: 'arc', c: pt(0, 0), r: 5, a0: 0, a1: Math.PI / 2, layer: 'contour' };
    const m = transformer(a, symetrie(pt(0, -1), pt(0, 1))) as Extract<DrawEntity, { kind: 'arc' }>;
    proche(Math.abs(m.a1 - m.a0), Math.PI / 2);
    proche(m.a1 - m.a0, -Math.PI / 2);
    // Le départ (5, 0) devient (−5, 0).
    proche(Math.cos(m.a0) * m.r, -5);
  });

  it('garde à une cote symétrisée sa ligne du même côté de l’objet', () => {
    const c: EntiteDessin = { kind: 'cote', a: pt(0, 0), b: pt(10, 0), decalage: 5, texte: '', layer: 'cotation' };
    const m = transformer(c, symetrie(pt(0, -1), pt(0, 1))) as Extract<EntiteDessin, { kind: 'cote' }>;
    // Les extrémités s'échangent : a→b garde son sens de lecture, la cote son côté.
    proche(m.a.x, -10);
    proche(m.b.x, 0);
    proche(m.a.y, 0);
    expect(m.decalage).toBe(5);
  });
});

describe('désignation au pointeur', () => {
  it('mesure la distance à chaque nature d’entité', () => {
    proche(distanceA(pt(5, 3), ligne(0, 0, 10, 0)), 3);
    proche(distanceA(pt(13, 0), { kind: 'cercle', c: pt(0, 0), r: 10, layer: 'contour' }), 3);
    const t: DrawEntity = { kind: 'texte', at: pt(0, 0), texte: 'ABCD', hauteur: 2, ancrage: 'gauche', ligneDeBase: 'bas', rotation: 0, gras: false, layer: 'texte' };
    expect(distanceA(pt(1, 1), t)).toBe(0);
    expect(distanceA(pt(1, 10), t)).toBeGreaterThan(5);
  });

  it('ne capte un masque que par son bord', () => {
    // ⚠ Sinon chaque clic posé sur un repère masqué sélectionnerait le masque.
    const m: DrawEntity = { kind: 'remplissage', contour: [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)], trous: [], gris: 1, layer: 'texte' };
    proche(distanceA(pt(5, 5), m), 5);
  });

  it('distingue la fenêtre (entièrement dedans) de la capture (touché)', () => {
    const f = { min: pt(0, 0), max: pt(10, 10) };
    const traversante = [ligne(-5, 5, 15, 5)];
    expect(contenuDans(traversante, f)).toBe(false);
    expect(toucheLaFenetre(traversante, f)).toBe(true);
    expect(contenuDans([ligne(2, 2, 8, 8)], f)).toBe(true);
    expect(toucheLaFenetre([ligne(20, 20, 30, 30)], f)).toBe(false);
  });
});

describe('accrochage', () => {
  const traits = [ligne(0, 0, 10, 0), ligne(5, -5, 5, 5)];

  it('s’accroche à l’extrémité, au milieu et à l’intersection', () => {
    expect(accrocher(pt(9.6, 0.3), traits, 1)).toMatchObject({ mode: 'extremite', p: { x: 10, y: 0 } });
    expect(accrocher(pt(5.2, 4.7), traits, 1)).toMatchObject({ mode: 'extremite' });
    const x = accrocher(pt(5.3, 0.2), traits, 1);
    expect(x?.p).toEqual(pt(5, 0));
    expect(['milieu', 'intersection']).toContain(x?.mode);
    expect(accrocher(pt(50, 50), traits, 1)).toBeNull();
  });

  it('ramène le point à l’horizontale ou à la verticale en ortho', () => {
    expect(ortho(pt(0, 0), pt(10, 2))).toEqual(pt(10, 0));
    expect(ortho(pt(0, 0), pt(1, -8))).toEqual(pt(0, -8));
  });
});
