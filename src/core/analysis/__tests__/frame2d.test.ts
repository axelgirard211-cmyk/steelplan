import { describe, expect, it } from 'vitest';
import {
  APPUI_ENCASTRE,
  APPUI_ROTULE,
  internalForces,
  resoudre,
  solveFrame2d,
  type Element2,
  type Frame2dInput,
} from '../frame2d';

/**
 * VALIDATION DU SOLVEUR contre des solutions analytiques connues.
 *
 * Un solveur non validé est pire qu'aucun solveur : il produit des nombres
 * plausibles que personne ne peut contredire. On le confronte donc aux cas de la
 * résistance des matériaux dont la réponse exacte est connue depuis deux siècles.
 */
const E = 210_000; // N/mm²
const I = 23_130e4; // IPE 400, mm⁴
const A = 8450; // mm²

const elem = (a: number, b: number, opts: Partial<Element2> = {}): Element2 => ({
  a,
  b,
  A,
  I,
  E,
  qPerp: 0,
  qAxial: 0,
  ...opts,
});

describe('poutre sur deux appuis simples, charge répartie', () => {
  const L = 6000;
  const q = 10; // N/mm, vers le bas
  const input: Frame2dInput = {
    nodes: [
      { y: 0, z: 0 },
      { y: L, z: 0 },
    ],
    elements: [elem(0, 1, { qPerp: -q })],
    supports: new Map([
      [0, APPUI_ROTULE],
      [1, { uy: false, uz: true, rot: false }],
    ]),
    nodalLoads: new Map(),
  };
  const r = solveFrame2d(input);

  it('retrouve le moment en travée qL²/8', () => {
    const f = r.endForces[0];
    if (!f) throw new Error('pas de résultat');
    const forces = internalForces(input.elements[0] as Element2, f, L);
    expect(Math.abs(forces.M)).toBeCloseTo((q * L * L) / 8, 2);
    // Le maximum est bien à mi-portée.
    expect(forces.xM).toBeCloseTo(0.5, 6);
  });

  it('annule le moment sur les appuis', () => {
    const f = r.endForces[0];
    expect(Math.abs(f?.M1 ?? 1)).toBeLessThan(1e-6);
    expect(Math.abs(f?.M2 ?? 1)).toBeLessThan(1e-6);
  });

  it('retrouve l’effort tranchant qL/2 aux appuis', () => {
    const f = r.endForces[0];
    expect(Math.abs(f?.V1 ?? 0)).toBeCloseTo((q * L) / 2, 6);
    expect(Math.abs(f?.V2 ?? 0)).toBeCloseTo((q * L) / 2, 6);
  });

  it('retrouve la flèche 5qL⁴/384EI', () => {
    // Flèche à mi-portée : on ajoute un nœud au milieu pour la lire.
    const avecMilieu: Frame2dInput = {
      nodes: [
        { y: 0, z: 0 },
        { y: L / 2, z: 0 },
        { y: L, z: 0 },
      ],
      elements: [elem(0, 1, { qPerp: -q }), elem(1, 2, { qPerp: -q })],
      supports: new Map([
        [0, APPUI_ROTULE],
        [2, { uy: false, uz: true, rot: false }],
      ]),
      nodalLoads: new Map(),
    };
    const res = solveFrame2d(avecMilieu);
    const attendu = (5 * q * L ** 4) / (384 * E * I);
    expect(Math.abs(res.d[4] as number)).toBeCloseTo(attendu, 3);
    // La flèche est bien dirigée vers le bas.
    expect(res.d[4] as number).toBeLessThan(0);
  });

  it('équilibre les réactions avec la charge appliquée', () => {
    const total = [...r.reactions.values()].reduce((s, [, fz]) => s + fz, 0);
    expect(total).toBeCloseTo(q * L, 3);
  });
});

describe('console encastrée, charge en bout', () => {
  const L = 3000;
  const P = 20_000; // N vers le bas
  const input: Frame2dInput = {
    nodes: [
      { y: 0, z: 0 },
      { y: L, z: 0 },
    ],
    elements: [elem(0, 1)],
    supports: new Map([[0, APPUI_ENCASTRE]]),
    nodalLoads: new Map([[1, [0, -P, 0]]]),
  };
  const r = solveFrame2d(input);

  it('retrouve le moment d’encastrement PL', () => {
    expect(Math.abs(r.endForces[0]?.M1 ?? 0)).toBeCloseTo(P * L, 3);
  });

  it('retrouve la flèche PL³/3EI', () => {
    expect(Math.abs(r.d[4] as number)).toBeCloseTo((P * L ** 3) / (3 * E * I), 4);
  });

  it('reprend tout l’effort à l’encastrement', () => {
    const [, fz, m] = r.reactions.get(0) ?? [0, 0, 0];
    expect(fz).toBeCloseTo(P, 3);
    expect(Math.abs(m)).toBeCloseTo(P * L, 3);
  });
});

describe('poutre bi-encastrée, charge répartie', () => {
  const L = 8000;
  const q = 15;
  const input: Frame2dInput = {
    nodes: [
      { y: 0, z: 0 },
      { y: L, z: 0 },
    ],
    elements: [elem(0, 1, { qPerp: -q })],
    supports: new Map([
      [0, APPUI_ENCASTRE],
      [1, APPUI_ENCASTRE],
    ]),
    nodalLoads: new Map(),
  };
  const r = solveFrame2d(input);

  it('retrouve les moments d’encastrement qL²/12', () => {
    const f = r.endForces[0];
    expect(Math.abs(f?.M1 ?? 0)).toBeCloseTo((q * L * L) / 12, 2);
    expect(Math.abs(f?.M2 ?? 0)).toBeCloseTo((q * L * L) / 12, 2);
  });

  it('retrouve le moment en travée qL²/24', () => {
    const f = r.endForces[0];
    if (!f) throw new Error('pas de résultat');
    const e = input.elements[0] as Element2;
    const aMiPortee = f.M1 + f.V1 * (L / 2) + (e.qPerp * (L / 2) ** 2) / 2;
    expect(Math.abs(aMiPortee)).toBeCloseTo((q * L * L) / 24, 2);
    // Et il est de signe opposé au moment d'appui : la poutre s'incurve.
    expect(Math.sign(aMiPortee)).toBe(-Math.sign(f.M1));
  });
});

describe('traction simple', () => {
  it('retrouve l’allongement NL/EA', () => {
    const L = 4000;
    const N = 100_000;
    const r = solveFrame2d({
      nodes: [
        { y: 0, z: 0 },
        { y: L, z: 0 },
      ],
      elements: [elem(0, 1)],
      supports: new Map([[0, APPUI_ENCASTRE]]),
      nodalLoads: new Map([[1, [N, 0, 0]]]),
    });
    expect(r.d[3] as number).toBeCloseTo((N * L) / (E * A), 6);
    // Effort normal de traction, donc positif.
    expect(r.endForces[0]?.N2 ?? 0).toBeCloseTo(N, 3);
  });
});

describe('portique articulé en pied, charge horizontale', () => {
  const H = 6000;
  const L = 12_000;
  const P = 30_000;
  const r = solveFrame2d({
    nodes: [
      { y: 0, z: 0 },
      { y: 0, z: H },
      { y: L, z: H },
      { y: L, z: 0 },
    ],
    elements: [elem(0, 1), elem(1, 2), elem(3, 2)],
    supports: new Map([
      [0, APPUI_ROTULE],
      [3, APPUI_ROTULE],
    ]),
    nodalLoads: new Map([[1, [P, 0, 0]]]),
  });

  it('équilibre l’effort horizontal', () => {
    const somme = [...r.reactions.values()].reduce((s, [fy]) => s + fy, 0);
    expect(somme).toBeCloseTo(-P, 3);
  });

  it('équilibre les efforts verticaux', () => {
    const somme = [...r.reactions.values()].reduce((s, [, fz]) => s + fz, 0);
    expect(Math.abs(somme)).toBeLessThan(1e-3);
  });

  it('annule le moment sur les rotules de pied', () => {
    for (const [, , m] of r.reactions.values()) expect(Math.abs(m)).toBeLessThan(1e-6);
  });

  it('déplace la tête dans le sens de la charge', () => {
    expect(r.d[3] as number).toBeGreaterThan(0);
    // Les deux têtes se déplacent presque ensemble : la traverse les solidarise,
    // à son raccourcissement élastique près — quelques dixièmes de millimètre.
    const ecart = Math.abs((r.d[6] as number) - (r.d[3] as number));
    expect(ecart).toBeLessThan(0.5);
    expect(ecart).toBeGreaterThan(0); // la traverse n'est pas indéformable
  });
});

describe('robustesse du solveur', () => {
  it('résout un système bien conditionné exactement', () => {
    const x = resoudre(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    expect(x[0]).toBeCloseTo(2, 9);
    expect(x[1]).toBeCloseTo(3, 9);
    expect(x[2]).toBeCloseTo(-1, 9);
  });

  it('résout malgré un premier pivot nul, grâce au pivot partiel', () => {
    // 2b + c = 5 ; a + b + c = 6 ; 2a + b = 5  ⇒  a = 2, b = 1, c = 3.
    const x = resoudre(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 0],
      ],
      [5, 6, 5],
    );
    expect(x[0]).toBeCloseTo(2, 9);
    expect(x[1]).toBeCloseTo(1, 9);
    expect(x[2]).toBeCloseTo(3, 9);
  });

  it('signale un mécanisme plutôt que de rendre des nombres absurdes', () => {
    expect(() =>
      solveFrame2d({
        nodes: [
          { y: 0, z: 0 },
          { y: 1000, z: 0 },
        ],
        elements: [{ a: 0, b: 1, A, I, E, qPerp: -1, qAxial: 0 }],
        supports: new Map(), // aucun appui
        nodalLoads: new Map(),
      }),
    ).toThrow(/singulier|tenue/);
  });
});
