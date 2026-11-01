import { describe, expect, it } from 'vitest';
import { factoriser, resoudre, substituer } from '../lu';

/**
 * FACTORISATION LU — le cœur de tous les calculs de portique.
 *
 * ⚠ Une erreur ici ne fait pas planter le logiciel : elle rend des déplacements
 * faux, donc des taux de travail faux, sans le moindre signal. D'où trois
 * exigences vérifiées une à une : l'exactitude sur un système connu, la tenue sur
 * un système mal conditionné grâce au pivot, et le refus net d'un mécanisme.
 */

/** Élimination de Gauss SANS pivot, pour montrer ce que le pivot évite. */
function gaussSansPivot(A: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const a = A.map((l) => [...l]);
  const y = [...b];
  for (let c = 0; c < n; c++) {
    for (let r = c + 1; r < n; r++) {
      const f = (a[r]![c] as number) / (a[c]![c] as number);
      for (let k = c; k < n; k++) a[r]![k] = (a[r]![k] as number) - f * (a[c]![k] as number);
      y[r] = (y[r] as number) - f * (y[c] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i] as number;
    for (let j = i + 1; j < n; j++) s -= (a[i]![j] as number) * (x[j] as number);
    x[i] = s / (a[i]![i] as number);
  }
  return x;
}

const produit = (A: readonly (readonly number[])[], x: readonly number[]): number[] =>
  A.map((l) => l.reduce((s, v, j) => s + v * (x[j] as number), 0));

describe('résolution d’un système connu', () => {
  /*
   *   2x +  y −  z =   8
   *  −3x −  y + 2z = −11
   *  −2x +  y + 2z =  −3      ⇒  x = 2, y = 3, z = −1
   */
  const A = [
    [2, 1, -1],
    [-3, -1, 2],
    [-2, 1, 2],
  ];
  const b = [8, -11, -3];

  it('rend la solution exacte à 1e-12 près', () => {
    const x = resoudre(A, b);
    expect(x).toHaveLength(3);
    for (const [i, attendu] of [2, 3, -1].entries()) {
      expect(Math.abs((x[i] as number) - attendu), `x[${i}]`).toBeLessThan(1e-12);
    }
  });

  it('sert une même factorisation à plusieurs seconds membres', () => {
    // Une ossature, autant de cas de charge : la factorisation ne se refait pas.
    const { lu, piv } = factoriser(A);
    for (const x of [
      [1, 0, 0],
      [0, -4, 7],
      [1.5, 2.25, -3.125],
    ]) {
      const r = substituer(lu, piv, produit(A, x));
      for (const [i, v] of x.entries()) expect(Math.abs((r[i] as number) - v), `${x} [${i}]`).toBeLessThan(1e-12);
    }
  });

  it('ne modifie pas la matrice ni le second membre reçus', () => {
    const copieA = A.map((l) => [...l]);
    const copieB = [...b];
    resoudre(A, b);
    expect(A).toEqual(copieA);
    expect(b).toEqual(copieB);
  });
});

describe('système mal conditionné', () => {
  /*
   * Conditionnement ≈ 9·10⁹ : les lignes 2 et 3 ne diffèrent que de 10⁻⁹, et le
   * premier pivot naturel vaut 10⁻¹⁷. C'est l'image d'un nœud dont un terme de
   * rigidité est négligeable devant ses voisins.
   */
  const eps = 1e-9;
  const A = [
    [1e-17, 1, 1],
    [1, 1, 2],
    [1, 1 + eps, 2],
  ];
  const attendu = [1, 2, 3];
  const b = produit(A, attendu);

  it('est résolu grâce au pivot partiel', () => {
    const x = resoudre(A, b);
    // Erreur relative admissible ≈ conditionnement × 10⁻¹⁶ ≈ 10⁻⁶.
    for (const [i, v] of attendu.entries()) expect(Math.abs((x[i] as number) - v), `x[${i}]`).toBeLessThan(1e-6);
    // Et le résidu, lui, est au niveau des arrondis.
    for (const [i, r] of produit(A, x).entries()) expect(Math.abs(r - (b[i] as number)), `résidu ${i}`).toBeLessThan(1e-12);
  });

  it('part en vrille sans pivot : c’est le pivot qui fait la différence', () => {
    const x = gaussSansPivot(A, b);
    const faux = x.some((v, i) => !Number.isFinite(v) || Math.abs(v - (attendu[i] as number)) > 1e-3);
    expect(faux, `sans pivot : ${x.join(', ')}`).toBe(true);
  });

  it('choisit pour premier pivot la plus grande valeur de la colonne', () => {
    const { piv } = factoriser(A);
    // La ligne 0 (10⁻¹⁷) est échangée avec la première ligne de valeur 1.
    expect(piv[0]).not.toBe(0);
  });
});

describe('mécanisme', () => {
  it('refuse un ressort sans appui : « Système singulier »', () => {
    const k = 1e5;
    expect(() =>
      resoudre(
        [
          [k, -k],
          [-k, k],
        ],
        [1, -1],
      ),
    ).toThrow(/Système singulier/);
  });

  it('refuse un mécanisme dont le pivot résiduel n’est nul qu’aux arrondis près', () => {
    /*
     * ⚠ Trois ressorts en chaîne, aucun appui, raideurs de charpente (10⁸ et
     * 3·10⁸/7, inexact en binaire). Le dernier pivot n'est nul qu'aux arrondis
     * près, à l'échelle des raideurs : un critère absolu à 10⁻¹² le laisserait passer et le solveur rendrait des
     * déplacements absurdes. Le critère relatif à l'échelle de la matrice le
     * refuse.
     */
    const k1 = 1e8;
    const k2 = 3e8 / 7;
    const K = [
      [k1, -k1, 0],
      [-k1, k1 + k2, -k2],
      [0, -k2, k2],
    ];
    expect(() => factoriser(K)).toThrow(/Système singulier/);
    expect(() => resoudre(K, [0, 0, 1])).toThrow(/appuis insuffisants ou mécanisme/);
  });

  it('refuse une matrice nulle', () => {
    expect(() => factoriser([[0, 0], [0, 0]])).toThrow(/Système singulier/);
  });

  it('accepte le même système une fois appuyé', () => {
    // Le nœud 0 bloqué : on retire sa ligne et sa colonne, il reste un système sain.
    const k1 = 1e8;
    const k2 = 3e8 / 7;
    const x = resoudre(
      [
        [k1 + k2, -k2],
        [-k2, k2],
      ],
      [0, 1000],
    );
    // Ressorts en série : u2 = F/k1 + F/k2, u1 = F/k1.
    expect(x[0]).toBeCloseTo(1000 / k1, 15);
    expect(x[1]).toBeCloseTo(1000 / k1 + 1000 / k2, 15);
  });
});
