/**
 * SOLVEUR DE PORTIQUE PLAN — méthode des rigidités.
 *
 * Pourquoi un solveur et pas des formules : les vérifications d'éléments
 * demandent M, N et V dans chaque barre. Sur un portique, ces efforts dépendent
 * de la raideur relative des poteaux et des traverses ; aucune formule de cas
 * type ne les donne dès qu'un paramètre sort du cas prévu. Or ici TOUT est
 * paramétrable. Un solveur de 400 lignes est donc la seule réponse honnête —
 * c'est l'option que vous avez retenue en début de projet.
 *
 * Élément de poutre plane à 6 degrés de liberté, repère local x le long de la
 * barre. Numérotation globale : nœud i ⇒ degrés 3i (uy), 3i+1 (uz), 3i+2 (θ).
 *
 * Unités : N, mm, N·mm. Le module d'Young en N/mm².
 */

export interface Node2 {
  readonly y: number;
  readonly z: number;
}

export interface Element2 {
  /** Indices des nœuds d'extrémité. */
  readonly a: number;
  readonly b: number;
  /** Aire de la section (mm²). */
  readonly A: number;
  /** Inertie de flexion dans le plan (mm⁴). */
  readonly I: number;
  /** Module d'Young (N/mm²). */
  readonly E: number;
  /** Charge uniformément répartie PERPENDICULAIRE à l'axe (N/mm), positive selon z local. */
  readonly qPerp: number;
  /** Charge uniformément répartie AXIALE (N/mm), positive de a vers b. */
  readonly qAxial: number;
  /**
   * Barre ARTICULÉE à ses deux abouts : elle ne transmet qu'un effort normal.
   *
   * ⚠ C'est la modélisation juste d'une barre de triangulation boulonnée sur
   * gousset, et non une simplification. La traiter à nœuds rigides fait apparaître
   * dans les diagonales des moments secondaires d'un ordre de grandeur supérieur à
   * ce qu'elles voient réellement — 6 kN·m sur une cornière dont l'effort normal ne
   * mobilise que 34 % de la section. Le résultat est bien du côté sûr, mais il
   * condamne un dimensionnement correct, ce qui ne sert personne.
   *
   * Les membrures, elles, sont d'un seul tenant : elles restent continues.
   */
  readonly articule?: boolean;
}

/** Conditions d'appui d'un nœud : chaque degré est bloqué ou libre. */
export interface Support {
  readonly uy: boolean;
  readonly uz: boolean;
  readonly rot: boolean;
}

export const APPUI_ROTULE: Support = { uy: true, uz: true, rot: false };
export const APPUI_ENCASTRE: Support = { uy: true, uz: true, rot: true };

export interface Frame2dInput {
  readonly nodes: readonly Node2[];
  readonly elements: readonly Element2[];
  /** Appuis, indexés par numéro de nœud. */
  readonly supports: ReadonlyMap<number, Support>;
  /** Charges nodales [Fy, Fz, M], indexées par numéro de nœud. */
  readonly nodalLoads: ReadonlyMap<number, readonly [number, number, number]>;
}

/** Efforts aux deux abouts d'un élément, dans son repère LOCAL. */
export interface EndForces {
  /** Effort normal à l'origine (N) ; positif = traction. */
  readonly N1: number;
  readonly V1: number;
  readonly M1: number;
  readonly N2: number;
  readonly V2: number;
  readonly M2: number;
}

export interface Frame2dResult {
  /** Déplacements globaux, 3 par nœud (mm, mm, rad). */
  readonly d: readonly number[];
  readonly endForces: readonly EndForces[];
  /** Réactions d'appui [Fy, Fz, M] par nœud appuyé. */
  readonly reactions: ReadonlyMap<number, readonly [number, number, number]>;
}

/* ------------------------------------------------------------------ */

/** Longueur et cosinus directeurs d'un élément. */
function geometrie(
  n: readonly Node2[],
  e: Element2,
): { L: number; c: number; s: number } {
  const a = n[e.a] as Node2;
  const b = n[e.b] as Node2;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const L = Math.hypot(dy, dz);
  if (L < 1e-9) throw new Error('Élément de longueur nulle dans le modèle de calcul.');
  return { L, c: dy / L, s: dz / L };
}

/** Matrice de rigidité élémentaire, repère local (6 × 6). */
export function rigiditeLocale(
  E: number,
  A: number,
  I: number,
  L: number,
  articule = false,
): number[][] {
  const ea = (E * A) / L;
  if (articule) {
    // Barre : rigidité axiale seule. Aucun terme de flexion, donc aucun moment
    // transmis aux nœuds.
    return [
      [ea, 0, 0, -ea, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [-ea, 0, 0, ea, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ];
  }
  const a1 = (12 * E * I) / L ** 3;
  const a2 = (6 * E * I) / L ** 2;
  const a3 = (4 * E * I) / L;
  const a4 = (2 * E * I) / L;
  return [
    [ea, 0, 0, -ea, 0, 0],
    [0, a1, a2, 0, -a1, a2],
    [0, a2, a3, 0, -a2, a4],
    [-ea, 0, 0, ea, 0, 0],
    [0, -a1, -a2, 0, a1, -a2],
    [0, a2, a4, 0, -a2, a3],
  ];
}

/** Matrice de passage global → local (6 × 6). */
function passage(c: number, s: number): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

/**
 * Charges NODALES ÉQUIVALENTES d'une charge répartie, repère local.
 *
 * Convention : `qPerp` positive selon z local, `qAxial` positive de a vers b. Le
 * vecteur renvoyé se cumule au second membre — ce sont bien les efforts appliqués
 * aux nœuds, et non les réactions d'encastrement, dont ils sont l'opposé. Les
 * confondre inverse le signe de tous les moments : on retranche donc ce même
 * vecteur des efforts d'extrémité au retour.
 */
export function chargesEquivalentes(
  qPerp: number,
  qAxial: number,
  L: number,
  articule = false,
): number[] {
  return [
    (qAxial * L) / 2,
    (qPerp * L) / 2,
    // Une barre articulée ne peut pas recevoir de moment d'about : la charge
    // répartie s'y réduit à deux réactions verticales.
    articule ? 0 : (qPerp * L * L) / 12,
    (qAxial * L) / 2,
    (qPerp * L) / 2,
    articule ? 0 : -(qPerp * L * L) / 12,
  ];
}

/* ------------------------------------------------------------------ */

export function solveFrame2d(input: Frame2dInput): Frame2dResult {
  const n = input.nodes.length;
  const ndof = 3 * n;
  const K: number[][] = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0));
  const F = new Array<number>(ndof).fill(0);

  // Charges nodales.
  for (const [i, [fy, fz, m]] of input.nodalLoads) {
    F[3 * i] = (F[3 * i] ?? 0) + fy;
    F[3 * i + 1] = (F[3 * i + 1] ?? 0) + fz;
    F[3 * i + 2] = (F[3 * i + 2] ?? 0) + m;
  }

  // Assemblage.
  const donneesElem: { k: number[][]; T: number[][]; fe: number[]; dofs: number[] }[] = [];
  for (const e of input.elements) {
    const { L, c, s } = geometrie(input.nodes, e);
    const k = rigiditeLocale(e.E, e.A, e.I, L, e.articule ?? false);
    const T = passage(c, s);
    const kg = multiplier(transposer(T), multiplier(k, T));
    const fe = chargesEquivalentes(e.qPerp, e.qAxial, L, e.articule ?? false);
    // Les charges équivalentes passent au second membre, en repère global.
    const feGlobal = multiplierVecteur(transposer(T), fe);
    const dofs = [3 * e.a, 3 * e.a + 1, 3 * e.a + 2, 3 * e.b, 3 * e.b + 1, 3 * e.b + 2];

    for (let i = 0; i < 6; i++) {
      const di = dofs[i] as number;
      F[di] = (F[di] ?? 0) + (feGlobal[i] as number);
      for (let j = 0; j < 6; j++) {
        const dj = dofs[j] as number;
        (K[di] as number[])[dj] = ((K[di] as number[])[dj] ?? 0) + ((kg[i] as number[])[j] as number);
      }
    }
    donneesElem.push({ k, T, fe, dofs });
  }

  // Appuis : on élimine les degrés bloqués plutôt que de pénaliser, ce qui évite
  // tout choix arbitraire de raideur de ressort.
  const bloque = new Array<boolean>(ndof).fill(false);
  for (const [i, s] of input.supports) {
    if (s.uy) bloque[3 * i] = true;
    if (s.uz) bloque[3 * i + 1] = true;
    if (s.rot) bloque[3 * i + 2] = true;
  }
  const libres: number[] = [];
  for (let i = 0; i < ndof; i++) if (!bloque[i]) libres.push(i);

  // ⚠ Une structure entièrement bloquée n'a rien à résoudre, mais ses éléments
  // portent quand même les efforts de leurs charges réparties : on ne sort pas
  // sans les calculer, sinon une poutre bi-encastrée sortirait sans moment.
  const d = new Array<number>(ndof).fill(0);
  if (libres.length > 0) {
    const Kr = libres.map((i) => libres.map((j) => (K[i] as number[])[j] as number));
    const Fr = libres.map((i) => F[i] as number);
    const dr = resoudre(Kr, Fr);
    for (const [k, i] of libres.entries()) d[i] = dr[k] as number;
  }

  // Efforts d'extrémité, repère local.
  const endForces: EndForces[] = donneesElem.map(({ k, T, fe, dofs }) => {
    const dGlobal = dofs.map((i) => d[i] as number);
    const dLocal = multiplierVecteur(T, dGlobal);
    const f = multiplierVecteur(k, dLocal).map((v, i) => v - (fe[i] as number));
    // Convention de sortie : N positif en traction, donc l'about d'origine
    // change de signe.
    return {
      N1: -(f[0] as number),
      V1: f[1] as number,
      M1: -(f[2] as number),
      N2: f[3] as number,
      V2: f[4] as number,
      M2: f[5] as number,
    };
  });

  // Réactions : K·d − F sur les degrés bloqués.
  const reactions = new Map<number, readonly [number, number, number]>();
  for (const [i] of input.supports) {
    const r: number[] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const dof = 3 * i + c;
      let somme = 0;
      for (let j = 0; j < ndof; j++) somme += ((K[dof] as number[])[j] as number) * (d[j] as number);
      r[c] = somme - (F[dof] as number);
    }
    reactions.set(i, [r[0] as number, r[1] as number, r[2] as number]);
  }

  return { d, endForces, reactions };
}

/* ------------------------------------------------------------------ */
/* Efforts internes le long d'un élément                               */
/* ------------------------------------------------------------------ */

export interface InternalForces {
  /** Effort normal maximal en valeur absolue (N), et son signe. */
  readonly N: number;
  readonly V: number;
  /** Moment maximal en valeur absolue (N·mm). */
  readonly M: number;
  /** Abscisse relative du moment maximal (0 à 1). */
  readonly xM: number;
}

/**
 * Efforts internes maximaux le long d'un élément.
 *
 * L'effort tranchant varie linéairement sous charge répartie, le moment
 * paraboliquement : le maximum de moment n'est pas forcément à un about, et le
 * chercher aux seuls abouts sous-estimerait la sollicitation d'une traverse
 * chargée. On le cherche donc là où l'effort tranchant s'annule.
 */
export function internalForces(e: Element2, f: EndForces, L: number): InternalForces {
  const q = e.qPerp;
  // Équilibre du tronçon de gauche : M(x) = M1 + V1·x + q·x²/2, avec q compté
  // positif selon z local. Retenir le signe opposé — l'erreur naturelle —
  // multiplierait par huit le moment d'une poutre isostatique.
  const moment = (x: number): number => f.M1 + f.V1 * x + (q * x * x) / 2;

  const candidats = [0, L];
  if (Math.abs(q) > 1e-12) {
    // L'effort tranchant vaut V1 + q·x : il s'annule là où le moment est extrême.
    const x0 = -f.V1 / q;
    if (x0 > 0 && x0 < L) candidats.push(x0);
  }

  let M = 0;
  let xM = 0;
  for (const x of candidats) {
    const m = moment(x);
    if (Math.abs(m) > Math.abs(M)) {
      M = m;
      xM = x / L;
    }
  }

  return {
    N: Math.abs(f.N1) > Math.abs(f.N2) ? f.N1 : f.N2,
    V: Math.abs(f.V1) > Math.abs(f.V2) ? f.V1 : f.V2,
    M,
    xM,
  };
}

/* ------------------------------------------------------------------ */
/* Algèbre linéaire, réduite au strict nécessaire                       */
/* ------------------------------------------------------------------ */

function transposer(m: readonly number[][]): number[][] {
  const l = m.length;
  const c = (m[0] as number[]).length;
  return Array.from({ length: c }, (_, j) =>
    Array.from({ length: l }, (_, i) => (m[i] as number[])[j] as number),
  );
}

function multiplier(a: readonly number[][], b: readonly number[][]): number[][] {
  const n = a.length;
  const p = (b[0] as number[]).length;
  const m = b.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let k = 0; k < m; k++) s += ((a[i] as number[])[k] as number) * ((b[k] as number[])[j] as number);
      return s;
    }),
  );
}

function multiplierVecteur(a: readonly number[][], v: readonly number[]): number[] {
  return a.map((ligne) => ligne.reduce((s, x, j) => s + x * (v[j] as number), 0));
}

/**
 * Résolution d'un système dense par élimination de Gauss avec pivot partiel.
 *
 * Le pivot partiel n'est pas un luxe : sans lui, un portique dont les poteaux
 * sont beaucoup plus raides que les traverses produit des pivots minuscules et
 * la solution part en vrille silencieusement.
 */
export function resoudre(A: readonly number[][], b: readonly number[]): number[] {
  const n = b.length;
  const m = A.map((ligne, i) => [...ligne, b[i] as number]);

  // ⚠ Le critère de pivot nul doit être RELATIF à l'échelle de la matrice. Les
  // termes de rigidité d'une charpente valent 10⁵ à 10⁹ ; comparer un pivot à
  // 10⁻¹² absolu laisse passer les mécanismes, dont le pivot résiduel n'est nul
  // qu'aux arrondis près — soit 10⁻⁴ ici. Le solveur rendait alors des
  // déplacements absurdes sans rien signaler : c'est le pire comportement possible.
  let echelle = 0;
  for (const ligne of A) for (const v of ligne) echelle = Math.max(echelle, Math.abs(v));
  const seuil = Math.max(1e-12, echelle * 1e-10);

  for (let col = 0; col < n; col++) {
    // Pivot : la plus grande valeur absolue de la colonne restante.
    let meilleur = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs((m[r] as number[])[col] as number) > Math.abs((m[meilleur] as number[])[col] as number)) {
        meilleur = r;
      }
    }
    if (meilleur !== col) {
      const t = m[col] as number[];
      m[col] = m[meilleur] as number[];
      m[meilleur] = t;
    }

    const pivot = (m[col] as number[])[col] as number;
    if (Math.abs(pivot) < seuil) {
      throw new Error(
        'Système singulier : la structure n’est pas tenue (appuis insuffisants ou mécanisme).',
      );
    }

    for (let r = col + 1; r < n; r++) {
      const facteur = ((m[r] as number[])[col] as number) / pivot;
      if (facteur === 0) continue;
      for (let c = col; c <= n; c++) {
        (m[r] as number[])[c] =
          ((m[r] as number[])[c] as number) - facteur * ((m[col] as number[])[c] as number);
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let somme = (m[i] as number[])[n] as number;
    for (let j = i + 1; j < n; j++) somme -= ((m[i] as number[])[j] as number) * (x[j] as number);
    x[i] = somme / ((m[i] as number[])[i] as number);
  }
  return x;
}
