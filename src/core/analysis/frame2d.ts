import { factoriser, substituer } from './lu';

export { factoriser, resoudre, substituer } from './lu';
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

interface DonneesElement {
  readonly k: number[][];
  readonly T: number[][];
  readonly L: number;
  readonly dofs: readonly number[];
}

/** Rigidité assemblée et factorisée d'une ossature : ce qui ne dépend pas des charges. */
interface Rigidite {
  readonly ndof: number;
  readonly K: readonly (readonly number[])[];
  readonly libres: readonly number[];
  readonly lu: Float64Array;
  readonly piv: Int32Array;
  readonly elements: readonly DonneesElement[];
}

/**
 * ⚠ La rigidité ne dépend que de la géométrie, des sections et des appuis — pas
 * des charges. Chaque combinaison la réassemblait pourtant et la refactorisait
 * de zéro, puis l'analyse de sensibilité au second ordre recommençait encore :
 * pour une ferme de soixante nœuds, une élimination de Gauss complète par cas,
 * soit l'essentiel du temps de vérification. Elle est désormais factorisée une
 * fois et gardée : chaque cas de charge n'est plus qu'une substitution.
 */
const CACHE: { cle: string; rigidite: Rigidite | Error }[] = [];
const TAILLE_CACHE = 8;

/** Ce qui fixe la rigidité : nœuds, sections, articulations et appuis — jamais les charges. */
function cleDeRigidite(input: Frame2dInput): string {
  const n = input.nodes.map((p) => `${p.y},${p.z}`).join(';');
  const e = input.elements.map((x) => `${x.a},${x.b},${x.E},${x.A},${x.I},${x.articule ? 1 : 0}`).join(';');
  const a = [...input.supports.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([i, sp]) => `${i}:${sp.uy ? 1 : 0}${sp.uz ? 1 : 0}${sp.rot ? 1 : 0}`)
    .join(';');
  return `${n}|${e}|${a}`;
}

function rigiditeDe(input: Frame2dInput): Rigidite {
  const cle = cleDeRigidite(input);
  const connu = CACHE.find((c) => c.cle === cle);
  if (connu) {
    if (connu.rigidite instanceof Error) throw connu.rigidite;
    return connu.rigidite;
  }
  let rigidite: Rigidite | Error;
  try {
    rigidite = assembler(input);
  } catch (e) {
    rigidite = e instanceof Error ? e : new Error(String(e));
  }
  CACHE.unshift({ cle, rigidite });
  if (CACHE.length > TAILLE_CACHE) CACHE.pop();
  if (rigidite instanceof Error) throw rigidite;
  return rigidite;
}

function assembler(input: Frame2dInput): Rigidite {
  const n = input.nodes.length;
  const ndof = 3 * n;
  const K: number[][] = Array.from({ length: ndof }, () => new Array<number>(ndof).fill(0));
  const elements: DonneesElement[] = [];
  for (const e of input.elements) {
    const { L, c, s } = geometrie(input.nodes, e);
    const k = rigiditeLocale(e.E, e.A, e.I, L, e.articule ?? false);
    const T = passage(c, s);
    const kg = multiplier(transposer(T), multiplier(k, T));
    const dofs = [3 * e.a, 3 * e.a + 1, 3 * e.a + 2, 3 * e.b, 3 * e.b + 1, 3 * e.b + 2];
    for (let i = 0; i < 6; i++) {
      const ligne = K[dofs[i] as number] as number[];
      const kgi = kg[i] as number[];
      for (let j = 0; j < 6; j++) ligne[dofs[j] as number] = (ligne[dofs[j] as number] as number) + (kgi[j] as number);
    }
    elements.push({ k, T, L, dofs });
  }

  // Appuis : on élimine les degrés bloqués plutôt que de pénaliser, ce qui évite
  // tout choix arbitraire de raideur de ressort.
  const bloque = new Array<boolean>(ndof).fill(false);
  for (const [i, sp] of input.supports) {
    if (sp.uy) bloque[3 * i] = true;
    if (sp.uz) bloque[3 * i + 1] = true;
    if (sp.rot) bloque[3 * i + 2] = true;
  }
  const libres: number[] = [];
  for (let i = 0; i < ndof; i++) if (!bloque[i]) libres.push(i);
  const { lu, piv } = factoriser(libres.map((i) => libres.map((j) => (K[i] as number[])[j] as number)));
  return { ndof, K, libres, lu, piv, elements };
}

export function solveFrame2d(input: Frame2dInput): Frame2dResult {
  const r = rigiditeDe(input);
  const { ndof, K, libres } = r;
  const F = new Array<number>(ndof).fill(0);

  // Charges nodales.
  for (const [i, [fy, fz, m]] of input.nodalLoads) {
    F[3 * i] = (F[3 * i] ?? 0) + fy;
    F[3 * i + 1] = (F[3 * i + 1] ?? 0) + fz;
    F[3 * i + 2] = (F[3 * i + 2] ?? 0) + m;
  }

  // Charges réparties : leurs équivalents nodaux passent au second membre, en repère global.
  const fes = input.elements.map((e, n) => {
    const { T, L, dofs } = r.elements[n] as DonneesElement;
    const fe = chargesEquivalentes(e.qPerp, e.qAxial, L, e.articule ?? false);
    const feGlobal = multiplierVecteur(transposer(T), fe);
    for (let i = 0; i < 6; i++) F[dofs[i] as number] = (F[dofs[i] as number] as number) + (feGlobal[i] as number);
    return fe;
  });

  // ⚠ Une structure entièrement bloquée n'a rien à résoudre, mais ses éléments
  // portent quand même les efforts de leurs charges réparties : on ne sort pas
  // sans les calculer, sinon une poutre bi-encastrée sortirait sans moment.
  const d = new Array<number>(ndof).fill(0);
  if (libres.length > 0) {
    const dr = substituer(r.lu, r.piv, libres.map((i) => F[i] as number));
    for (const [k, i] of libres.entries()) d[i] = dr[k] as number;
  }

  // Efforts d'extrémité, repère local.
  const endForces: EndForces[] = r.elements.map(({ k, T, dofs }, n) => {
    const fe = fes[n] as number[];
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
    const rr: number[] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const dof = 3 * i + c;
      const ligne = K[dof] as readonly number[];
      let somme = 0;
      for (let j = 0; j < ndof; j++) somme += (ligne[j] as number) * (d[j] as number);
      rr[c] = somme - (F[dof] as number);
    }
    reactions.set(i, [rr[0] as number, rr[1] as number, rr[2] as number]);
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
