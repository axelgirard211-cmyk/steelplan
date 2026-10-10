import { describe, expect, it } from 'vitest';
import { ajuster, arcPar3Points, decaler, poigneesDe, prolonger } from '../operations2d';
import { pt, type DrawEntity } from '../scene';

const ligne = (x0: number, y0: number, x1: number, y1: number): Extract<DrawEntity, { kind: 'ligne' }> => ({ kind: 'ligne', a: pt(x0, y0), b: pt(x1, y1), layer: 'contour' });

describe('décaler', () => {
  it('décale une ligne du côté du point visé', () => {
    expect(decaler(ligne(0, 0, 10, 0), 2, pt(5, 3))).toMatchObject({ a: { x: 0, y: 2 }, b: { x: 10, y: 2 } });
    expect(decaler(ligne(0, 0, 10, 0), 2, pt(5, -3))).toMatchObject({ a: { x: 0, y: -2 }, b: { x: 10, y: -2 } });
  });

  it('décale un rectangle vers l’extérieur en raccordant les angles', () => {
    const rect: DrawEntity = { kind: 'polyligne', points: [pt(0, 0), pt(10, 0), pt(10, 5), pt(0, 5)], fermee: true, layer: 'contour' };
    const d = decaler(rect, 1, pt(5, -4)) as Extract<DrawEntity, { kind: 'polyligne' }>;
    expect(d.points.map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6])).toEqual([
      [-1, -1],
      [11, -1],
      [11, 6],
      [-1, 6],
    ]);
  });

  it('agrandit ou réduit un cercle selon le côté', () => {
    const c: DrawEntity = { kind: 'cercle', c: pt(0, 0), r: 10, layer: 'contour' };
    expect(decaler(c, 2, pt(20, 0))).toMatchObject({ r: 12 });
    expect(decaler(c, 2, pt(1, 0))).toMatchObject({ r: 8 });
    expect(decaler(c, 20, pt(1, 0))).toBeNull();
  });
});

describe('arc par trois points', () => {
  it('passe par les trois points, dans le bon sens', () => {
    const a = arcPar3Points(pt(10, 0), pt(0, 10), pt(-10, 0), 'contour') as Extract<DrawEntity, { kind: 'arc' }>;
    expect(a.c.x).toBeCloseTo(0, 9);
    expect(a.c.y).toBeCloseTo(0, 9);
    expect(a.r).toBeCloseTo(10, 9);
    // Demi-cercle supérieur : de 0 à π, sens trigonométrique.
    expect(a.a1 - a.a0).toBeCloseTo(Math.PI, 9);
    const b = arcPar3Points(pt(10, 0), pt(0, -10), pt(-10, 0), 'contour') as Extract<DrawEntity, { kind: 'arc' }>;
    expect(b.a1 - b.a0).toBeCloseTo(-Math.PI, 9);
  });

  it('refuse trois points alignés', () => {
    expect(arcPar3Points(pt(0, 0), pt(1, 1), pt(2, 2), 'contour')).toBeNull();
  });
});

describe('ajuster et prolonger', () => {
  const croix = [ligne(3, -5, 3, 5), ligne(7, -5, 7, 5)];

  it('retire le tronçon cliqué entre les deux traits qui l’encadrent', () => {
    const r = ajuster(ligne(0, 0, 10, 0), pt(5, 0.2), croix);
    expect(r).toHaveLength(2);
    expect(r?.[0]).toMatchObject({ a: { x: 0 }, b: { x: 3 } });
    expect(r?.[1]).toMatchObject({ a: { x: 7 }, b: { x: 10 } });
  });

  it('retire un bout qui dépasse', () => {
    const r = ajuster(ligne(0, 0, 10, 0), pt(9, 0), croix);
    expect(r).toEqual([{ kind: 'ligne', a: pt(0, 0), b: pt(7, 0), layer: 'contour' }]);
  });

  it('ne fait rien sans trait qui coupe', () => {
    expect(ajuster(ligne(0, 20, 10, 20), pt(5, 20), [ligne(0, 0, 10, 0)])).toBeNull();
  });

  it('prolonge jusqu’au premier trait rencontré, par le bout le plus proche du clic', () => {
    expect(prolonger(ligne(4, 0, 5, 0), pt(4.9, 0), croix)).toMatchObject({ a: { x: 4 }, b: { x: 7 } });
    expect(prolonger(ligne(4, 0, 5, 0), pt(4.1, 0), croix)).toMatchObject({ a: { x: 3 }, b: { x: 5 } });
    expect(prolonger(ligne(8, 0, 9, 0), pt(8.9, 0), croix)).toBeNull();
  });

  it('prolonge jusqu’à un cercle', () => {
    const r = prolonger(ligne(0, 0, 1, 0), pt(0.9, 0), [{ kind: 'cercle', c: pt(10, 0), r: 2, layer: 'contour' }]);
    expect(r?.b.x).toBeCloseTo(8, 9);
  });
});

describe('poignées', () => {
  it('étire une ligne par son bout, la déplace par son milieu', () => {
    const [a, , m] = poigneesDe(ligne(0, 0, 10, 0));
    expect(a?.vers(pt(-5, 0))).toMatchObject({ a: { x: -5 }, b: { x: 10 } });
    expect(m?.vers(pt(5, 3))).toMatchObject({ a: { x: 0, y: 3 }, b: { x: 10, y: 3 } });
  });

  it('change le rayon d’un cercle par un quadrant', () => {
    const p = poigneesDe({ kind: 'cercle', c: pt(0, 0), r: 5, layer: 'contour' });
    expect(p).toHaveLength(5);
    expect(p[1]?.vers(pt(8, 0))).toMatchObject({ r: 8 });
  });

  it('règle la ligne d’une cote par sa poignée centrale', () => {
    const p = poigneesDe({ kind: 'cote', a: pt(0, 0), b: pt(10, 0), decalage: 5, texte: '', layer: 'cotation' });
    expect(p[2]?.p).toEqual(pt(5, 5));
    expect(p[2]?.vers(pt(5, 9))).toMatchObject({ decalage: 9 });
  });
});
