/**
 * ALGÈBRE LINÉAIRE DENSE — factorisation LU et substitution.
 *
 * Séparée du solveur de portique pour qu'une factorisation serve à plusieurs
 * seconds membres : une ossature, autant de cas de charge.
 */

/**
 * Factorisation LU d'un système dense, avec pivot partiel — l'élimination de
 * Gauss, dont on garde les multiplicateurs pour résoudre ensuite autant de
 * seconds membres qu'il y a de cas de charge.
 *
 * Le pivot partiel n'est pas un luxe : sans lui, un portique dont les poteaux
 * sont beaucoup plus raides que les traverses produit des pivots minuscules et
 * la solution part en vrille silencieusement.
 */
export function factoriser(A: readonly (readonly number[])[]): { lu: Float64Array; piv: Int32Array } {
  const n = A.length;
  const lu = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) lu[i * n + j] = (A[i] as readonly number[])[j] as number;
  const piv = new Int32Array(n);

  // ⚠ Le critère de pivot nul doit être RELATIF à l'échelle de la matrice. Les
  // termes de rigidité d'une charpente valent 10⁵ à 10⁹ ; comparer un pivot à
  // 10⁻¹² absolu laisse passer les mécanismes, dont le pivot résiduel n'est nul
  // qu'aux arrondis près — soit 10⁻⁴ ici. Le solveur rendait alors des
  // déplacements absurdes sans rien signaler : c'est le pire comportement possible.
  let echelle = 0;
  for (let k = 0; k < n * n; k++) echelle = Math.max(echelle, Math.abs(lu[k] as number));
  const seuil = Math.max(1e-12, echelle * 1e-10);

  for (let col = 0; col < n; col++) {
    // Pivot : la plus grande valeur absolue de la colonne restante.
    let meilleur = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(lu[r * n + col] as number) > Math.abs(lu[meilleur * n + col] as number)) meilleur = r;
    }
    piv[col] = meilleur;
    if (meilleur !== col) {
      for (let c = 0; c < n; c++) {
        const t = lu[col * n + c] as number;
        lu[col * n + c] = lu[meilleur * n + c] as number;
        lu[meilleur * n + c] = t;
      }
    }
    const pivot = lu[col * n + col] as number;
    if (Math.abs(pivot) < seuil) {
      throw new Error('Système singulier : la structure n’est pas tenue (appuis insuffisants ou mécanisme).');
    }
    for (let r = col + 1; r < n; r++) {
      const facteur = (lu[r * n + col] as number) / pivot;
      lu[r * n + col] = facteur;
      if (facteur === 0) continue;
      for (let c = col + 1; c < n; c++) lu[r * n + c] = (lu[r * n + c] as number) - facteur * (lu[col * n + c] as number);
    }
  }
  return { lu, piv };
}

/** Résolution d'un second membre sur une factorisation LU. */
export function substituer(lu: Float64Array, piv: Int32Array, b: readonly number[]): number[] {
  const n = b.length;
  const y = [...b];
  // ⚠ Les lignes ont été échangées ENTIÈRES, multiplicateurs compris : toutes les
  // permutations s'appliquent au second membre avant la descente, pas au fil d'elle.
  for (let col = 0; col < n; col++) {
    const p = piv[col] as number;
    if (p === col) continue;
    const t = y[col] as number;
    y[col] = y[p] as number;
    y[p] = t;
  }
  for (let col = 0; col < n; col++) {
    const yc = y[col] as number;
    if (yc !== 0) for (let r = col + 1; r < n; r++) y[r] = (y[r] as number) - (lu[r * n + col] as number) * yc;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let somme = y[i] as number;
    for (let j = i + 1; j < n; j++) somme -= (lu[i * n + j] as number) * (x[j] as number);
    x[i] = somme / (lu[i * n + i] as number);
  }
  return x;
}

/** Résolution d'un système dense par élimination de Gauss avec pivot partiel. */
export const resoudre = (A: readonly number[][], b: readonly number[]): number[] => {
  const { lu, piv } = factoriser(A);
  return substituer(lu, piv, b);
};
