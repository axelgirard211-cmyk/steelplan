import { buildingLength, ridgeHeight, ridgeY, leftSlopeRad, type GridParams } from '../model/grid';
import { rad2deg } from '../math/tolerance';
import { coefficientsParoi, coefficientsToiture, CPI_NEGATIF, CPI_POSITIF } from './vent';

/**
 * VENT PAR ZONES SUR UN PORTIQUE — EN 1991-1-4 § 7.2.2 à 7.2.5 et 7.2.9.
 *
 * ⚠ Le portique recevait deux nombres : une pression sur le seul poteau au vent
 * et une succion MOYENNE uniforme sur toute la toiture. Trois choses manquaient,
 * et chacune sous-estimait une sollicitation réelle :
 *  - la SUCCION de la paroi sous le vent (zone E), qui pousse le portique dans
 *    le même sens que la pression au vent — le déplacement en tête était sous-
 *    estimé d'un bon tiers ;
 *  - le ZONAGE de la toiture : bande de rive G sur e/10, puis H, et de l'autre
 *    côté du faîtage J puis I, chacune avec son coefficient ;
 *  - le vent sur PIGNON (θ = 90°), qui aspire toute la toiture et les deux
 *    long-pans à la fois : c'est lui qui soulève le plus les portiques de rive.
 * Et la pression intérieure n'était prise qu'avec un seul signe par valeur ; la
 * norme impose d'examiner +0,2 ET −0,3 (§ 7.2.9 (6), note 2).
 *
 * Coefficients cpe,10 (structure portée, aires chargées de plus de 10 m²) des
 * valeurs RECOMMANDÉES de la norme : tableaux 7.1, 7.3a-b et 7.4a-b. L'annexe
 * nationale française modifie le tableau 7.4a ; ses valeurs ne sont pas
 * reprises ici, et le rapport le dit.
 *
 * Convention : un coefficient NET (cpe − cpi) positif presse la paroi vers
 * l'intérieur du bâtiment, négatif l'aspire vers l'extérieur.
 */

export type Incidence = 'travers' | 'pignon';

export interface CasVent {
  readonly id: string;
  /** Travers : vent perpendiculaire au faîtage (θ = 0° / 180°) ; pignon : parallèle (θ = 90°). */
  readonly incidence: Incidence;
  /** Travers : +1 souffle vers les y croissants (il frappe le long-pan y = 0). */
  readonly sens: 1 | -1;
  /**
   * Versant au vent : entre 5° et 45°, la norme donne à F, G et H une valeur
   * négative ET une positive, à examiner séparément.
   */
  readonly versant: 'aspiration' | 'pression';
  readonly cpi: number;
  /** Repère court pour les libellés de combinaison. */
  readonly court: string;
}

const signe = (v: number): string => (v > 0 ? `+${v}` : `−${Math.abs(v)}`).replace('.', ',');

/**
 * Cas de vent à examiner. Travers dans les deux sens, aspiré avec les deux
 * pressions intérieures et poussé avec la plus défavorable (−0,3) ; pignon avec
 * les deux pressions intérieures. Le vent sur l'autre pignon est le même pour
 * les portiques analysés : chacun représente ses homologues des deux bouts.
 */
export function casDeVent(): CasVent[] {
  const out: CasVent[] = [];
  for (const sens of [1, -1] as const) {
    const fleche = sens > 0 ? '→' : '←';
    for (const cpi of [CPI_POSITIF, CPI_NEGATIF]) {
      out.push({ id: `T${sens > 0 ? '+' : '-'}A${cpi}`, incidence: 'travers', sens, versant: 'aspiration', cpi, court: `${fleche} cpi ${signe(cpi)}` });
    }
    out.push({ id: `T${sens > 0 ? '+' : '-'}P`, incidence: 'travers', sens, versant: 'pression', cpi: CPI_NEGATIF, court: `${fleche} poussé, cpi ${signe(CPI_NEGATIF)}` });
  }
  for (const cpi of [CPI_POSITIF, CPI_NEGATIF]) {
    out.push({ id: `P${cpi}`, incidence: 'pignon', sens: 1, versant: 'aspiration', cpi, court: `pignon, cpi ${signe(cpi)}` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tableaux de la norme                                                */
/* ------------------------------------------------------------------ */

type Ligne<K extends string> = { readonly a: number; readonly z: Readonly<Record<K, number>> };

/** Tableau 7.4b — deux versants, θ = 90°. */
const PIGNON_DEUX_VERSANTS: readonly Ligne<'F' | 'G' | 'H' | 'I'>[] = [
  { a: 5, z: { F: -1.6, G: -1.3, H: -0.7, I: -0.6 } },
  { a: 15, z: { F: -1.3, G: -1.3, H: -0.6, I: -0.5 } },
  { a: 30, z: { F: -1.1, G: -1.4, H: -0.8, I: -0.5 } },
  { a: 45, z: { F: -1.1, G: -1.4, H: -0.9, I: -0.5 } },
  { a: 60, z: { F: -1.1, G: -1.2, H: -0.8, I: -0.5 } },
  { a: 75, z: { F: -1.1, G: -1.2, H: -0.8, I: -0.5 } },
];

/** Tableau 7.3a — un versant, vent frappant l'égout HAUT (θ = 180°). */
const MONOPENTE_HAUT: readonly Ligne<'F' | 'G' | 'H'>[] = [
  { a: 5, z: { F: -2.3, G: -1.3, H: -0.8 } },
  { a: 15, z: { F: -2.5, G: -1.3, H: -0.9 } },
  { a: 30, z: { F: -1.1, G: -0.8, H: -0.8 } },
  { a: 45, z: { F: -0.6, G: -0.5, H: -0.7 } },
  { a: 60, z: { F: -0.5, G: -0.5, H: -0.5 } },
  { a: 75, z: { F: -0.5, G: -0.5, H: -0.5 } },
];

/** Tableau 7.3b — un versant, θ = 90° (Fhaut : angle côté égout haut). */
const PIGNON_MONOPENTE: readonly Ligne<'Fhaut' | 'Fbas' | 'G' | 'H' | 'I'>[] = [
  { a: 5, z: { Fhaut: -2.1, Fbas: -2.1, G: -1.8, H: -0.6, I: -0.5 } },
  { a: 15, z: { Fhaut: -2.4, Fbas: -1.6, G: -1.9, H: -0.8, I: -0.7 } },
  { a: 30, z: { Fhaut: -2.1, Fbas: -1.3, G: -1.5, H: -1.0, I: -0.8 } },
  { a: 45, z: { Fhaut: -1.5, Fbas: -1.3, G: -1.4, H: -1.0, I: -0.9 } },
  { a: 60, z: { Fhaut: -1.2, Fbas: -1.2, G: -1.2, H: -1.0, I: -0.7 } },
  { a: 75, z: { Fhaut: -1.2, Fbas: -1.2, G: -1.2, H: -1.0, I: -0.5 } },
];

/** Interpolation linéaire d'un tableau par la pente, bornée à ses extrémités. */
function interpoler<K extends string>(t: readonly Ligne<K>[], pente: number): Record<K, number> {
  const a = Math.min(t[t.length - 1]?.a ?? 75, Math.max(t[0]?.a ?? 5, pente));
  let i = 0;
  while (i + 1 < t.length && (t[i + 1] as Ligne<K>).a < a) i++;
  const bas = t[i] as Ligne<K>;
  const haut = (t[i + 1] ?? bas) as Ligne<K>;
  const k = haut.a === bas.a ? 0 : (a - bas.a) / (haut.a - bas.a);
  const out = {} as Record<K, number>;
  for (const z of Object.keys(bas.z) as K[]) out[z] = bas.z[z] + k * (haut.z[z] - bas.z[z]);
  return out;
}

/**
 * Succion de la bande de rive G — le long de l'égout au vent, hors angles F —,
 * la plus forte des vents de travers. C'est celle que reçoit la panne
 * sablière sur toute sa portée ; toutes les pannes ayant le même profil, c'est
 * elle qui les dimensionne. Sur un versant unique, le vent frappant l'égout
 * HAUT (θ = 180°) aspire davantage.
 */
export function cpePannes(g: GridParams): number {
  const pente = Math.abs(rad2deg(leftSlopeRad(g)));
  const auVent = coefficientsToiture(pente).G[0];
  return g.roofType === 'monopente' ? Math.min(auVent, interpoler(MONOPENTE_HAUT, pente).G) : auVent;
}

/* ------------------------------------------------------------------ */
/* Moyenne d'un champ de coefficients par zones rectangulaires          */
/* ------------------------------------------------------------------ */

/**
 * Moyenne exacte d'un coefficient constant par morceaux sur [x0, x1] × [y0, y1] :
 * les zones sont des rectangles, on découpe aux limites et on pondère par les
 * aires. Une bande de rive à cheval sur une barre est ainsi prise pour sa part.
 */
function moyenne(f: (x: number, y: number) => number, x0: number, x1: number, xs: readonly number[], y0: number, y1: number, ys: readonly number[]): number {
  const coupe = (a: number, b: number, l: readonly number[]): number[] => [a, ...l.filter((v) => v > a && v < b).sort((u, v) => u - v), b];
  const cx = coupe(x0, x1, xs);
  const cy = coupe(y0, y1, ys);
  let somme = 0;
  let aire = 0;
  for (let i = 0; i + 1 < cx.length; i++) {
    for (let j = 0; j + 1 < cy.length; j++) {
      const dx = (cx[i + 1] as number) - (cx[i] as number);
      const dy = (cy[j + 1] as number) - (cy[j] as number);
      const w = Math.max(dx, 1e-9) * Math.max(dy, 1e-9);
      somme += w * f(((cx[i] as number) + (cx[i + 1] as number)) / 2, ((cy[j] as number) + (cy[j + 1] as number)) / 2);
      aire += w;
    }
  }
  return aire > 0 ? somme / aire : f((x0 + x1) / 2, (y0 + y1) / 2);
}

export interface VentSurPortique {
  /** Coefficient net du long-pan y = 0, + vers l'intérieur. */
  readonly murGauche: number;
  /** Coefficient net du long-pan y = portée. */
  readonly murDroit: number;
  /** Coefficient net moyen de la toiture entre deux abscisses y (mm). */
  readonly toit: (ya: number, yb: number) => number;
}

/**
 * Coefficients nets que reçoit un portique dont la bande reprise va de x0 à x1
 * (mm, le long du bâtiment, depuis le pignon au vent quand le vent est sur
 * pignon).
 */
export function ventSurPortique(g: GridParams, cas: CasVent, x0: number, x1: number): VentSurPortique {
  const L = buildingLength(g);
  const B = g.span;
  const h = ridgeHeight(g);
  const pente = Math.abs(rad2deg(leftSlopeRad(g)));
  const monopente = g.roofType === 'monopente';
  const yr = ridgeY(g);
  const cpi = cas.cpi;

  if (cas.incidence === 'travers') {
    const e = Math.min(L, 2 * h);
    const paroi = coefficientsParoi(h / 1000, B / 1000);
    // Repère du vent : u = distance à l'égout AU VENT.
    const u = (y: number): number => (cas.sens > 0 ? y : B - y);
    const angle = (x: number): boolean => x < e / 4 || x > L - e / 4;
    const t74 = coefficientsToiture(pente);
    const v = (z: readonly [number, number]): number => (cas.versant === 'aspiration' ? z[0] : z[1]);
    let cpe: (x: number, y: number) => number;
    if (!monopente) {
      // Faîtage dans le repère du vent.
      const ur = cas.sens > 0 ? yr : B - yr;
      cpe = (x, y) => {
        const w = u(y);
        if (w <= ur) return w < e / 10 ? v(angle(x) ? t74.F : t74.G) : v(t74.H);
        // Versant sous le vent : J sur e/10 au faîtage, I au-delà — valeurs négatives.
        return w - ur < e / 10 ? t74.J[0] : t74.I[0];
      };
    } else if (cas.sens > 0) {
      // Vent sur l'égout BAS : mêmes F, G, H que le versant au vent d'un deux-versants.
      cpe = (x, y) => (u(y) < e / 10 ? v(angle(x) ? t74.F : t74.G) : v(t74.H));
    } else {
      const t = interpoler(MONOPENTE_HAUT, pente);
      cpe = (x, y) => (u(y) < e / 10 ? (angle(x) ? t.F : t.G) : t.H);
    }
    const xs = [e / 4, L - e / 4];
    const ys = [e / 10, B - e / 10, yr, yr + e / 10, yr - e / 10];
    const auVent = paroi.D - cpi;
    const sousLeVent = paroi.E - cpi;
    return {
      murGauche: cas.sens > 0 ? auVent : sousLeVent,
      murDroit: cas.sens > 0 ? sousLeVent : auVent,
      toit: (ya, yb) => moyenne(cpe, x0, x1, xs, Math.min(ya, yb), Math.max(ya, yb), ys) - cpi,
    };
  }

  // Vent sur pignon : x mesuré depuis le pignon au vent.
  const e = Math.min(B, 2 * h);
  const paroi = coefficientsParoi(h / 1000, L / 1000);
  const mur = (x: number): number => (x < e / 5 ? paroi.A : x < e ? paroi.B : paroi.C);
  const murMoyen = moyenne((x) => mur(x), x0, x1, [e / 5, e], 0, 1, []) - cpi;
  let cpe: (x: number, y: number) => number;
  if (!monopente) {
    const t = interpoler(PIGNON_DEUX_VERSANTS, pente);
    cpe = (x, y) => (x < e / 10 ? (y < e / 4 || y > B - e / 4 ? t.F : t.G) : x < e / 2 ? t.H : t.I);
  } else {
    const t = interpoler(PIGNON_MONOPENTE, pente);
    // Égout bas en y = 0, égout haut en y = portée.
    cpe = (x, y) => (x < e / 10 ? (y < e / 4 ? t.Fbas : y > B - e / 4 ? t.Fhaut : t.G) : x < e / 2 ? t.H : t.I);
  }
  return {
    murGauche: murMoyen,
    murDroit: murMoyen,
    toit: (ya, yb) => moyenne(cpe, x0, x1, [e / 10, e / 2], Math.min(ya, yb), Math.max(ya, yb), [e / 4, B - e / 4]) - cpi,
  };
}
