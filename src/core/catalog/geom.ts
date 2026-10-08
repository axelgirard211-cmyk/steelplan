/**
 * Calcul exact des caractéristiques de section à partir de la géométrie.
 *
 * Sert à deux choses :
 *  1. générer les profils dont les tables ne sont pas saisies (tubes, cornières
 *     à ailes inégales, plats) ;
 *  2. contrôler par recoupement les valeurs tabulées (tests de cohérence).
 *
 * Toutes les fonctions sont pures et travaillent en mm.
 */

/** Rectangle aligné sur les axes, coordonnées en mm. */
export interface Rect {
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

export function rect(y0: number, y1: number, z0: number, z1: number): Rect {
  return { y0, y1, z0, z1 };
}

/** Caractéristiques d'un ensemble de rectangles disjoints. */
export interface RectSetProps {
  readonly A: number;
  /** Centre de gravité. */
  readonly cy: number;
  readonly cz: number;
  /** Inerties centrales (mm⁴). */
  readonly Iy: number;
  readonly Iz: number;
  /** Produit d'inertie central (mm⁴), non nul pour une cornière. */
  readonly Iyz: number;
  /** Inerties principales (mm⁴). */
  readonly Imax: number;
  readonly Imin: number;
  /** Modules élastiques (mm³), fibre la plus éloignée. */
  readonly Wely: number;
  readonly Welz: number;
  /** Modules plastiques (mm³). */
  readonly Wply: number;
  readonly Wplz: number;
}

/**
 * Caractéristiques d'une section décrite par des rectangles **disjoints**.
 * (Un recouvrement serait compté deux fois : à l'appelant de découper.)
 */
export function rectSetProps(rects: readonly Rect[]): RectSetProps {
  let A = 0;
  let sy = 0;
  let sz = 0;
  for (const r of rects) {
    const a = (r.y1 - r.y0) * (r.z1 - r.z0);
    A += a;
    sy += a * ((r.y0 + r.y1) / 2);
    sz += a * ((r.z0 + r.z1) / 2);
  }
  const cy = sy / A;
  const cz = sz / A;

  let Iy = 0;
  let Iz = 0;
  let Iyz = 0;
  for (const r of rects) {
    const w = r.y1 - r.y0;
    const h = r.z1 - r.z0;
    const a = w * h;
    const dy = (r.y0 + r.y1) / 2 - cy;
    const dz = (r.z0 + r.z1) / 2 - cz;
    Iy += (w * h ** 3) / 12 + a * dz * dz;
    Iz += (h * w ** 3) / 12 + a * dy * dy;
    Iyz += a * dy * dz;
  }

  const half = (Iy + Iz) / 2;
  const rad = Math.hypot((Iy - Iz) / 2, Iyz);
  const Imax = half + rad;
  const Imin = half - rad;

  // Fibres extrêmes.
  let vz = 0;
  let vy = 0;
  for (const r of rects) {
    vz = Math.max(vz, Math.abs(r.z0 - cz), Math.abs(r.z1 - cz));
    vy = Math.max(vy, Math.abs(r.y0 - cy), Math.abs(r.y1 - cy));
  }

  return {
    A,
    cy,
    cz,
    Iy,
    Iz,
    Iyz,
    Imax,
    Imin,
    Wely: Iy / vz,
    Welz: Iz / vy,
    Wply: plasticModulus(rects, 'y'),
    Wplz: plasticModulus(rects, 'z'),
  };
}

/**
 * Module plastique autour de l'axe demandé : l'axe neutre plastique partage
 * la section en deux aires égales, Wpl = ∫|d| dA.
 * L'axe neutre est trouvé par dichotomie sur une fonction d'aire monotone.
 */
export function plasticModulus(rects: readonly Rect[], axis: 'y' | 'z'): number {
  const lo = Math.min(...rects.map((r) => (axis === 'y' ? r.z0 : r.y0)));
  const hi = Math.max(...rects.map((r) => (axis === 'y' ? r.z1 : r.y1)));
  const total = rects.reduce((s, r) => s + (r.y1 - r.y0) * (r.z1 - r.z0), 0);

  const areaBelow = (p: number): number =>
    rects.reduce((s, r) => {
      const w = axis === 'y' ? r.y1 - r.y0 : r.z1 - r.z0;
      const a0 = axis === 'y' ? r.z0 : r.y0;
      const a1 = axis === 'y' ? r.z1 : r.y1;
      return s + w * Math.max(0, Math.min(p, a1) - a0);
    }, 0);

  let a = lo;
  let b = hi;
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2;
    if (areaBelow(m) < total / 2) a = m;
    else b = m;
  }
  const pna = (a + b) / 2;

  // ∫|d| dA, en découpant chaque rectangle de part et d'autre de l'axe neutre.
  let s = 0;
  for (const r of rects) {
    const w = axis === 'y' ? r.y1 - r.y0 : r.z1 - r.z0;
    const a0 = axis === 'y' ? r.z0 : r.y0;
    const a1 = axis === 'y' ? r.z1 : r.y1;
    const cut = Math.max(a0, Math.min(pna, a1));
    // Partie sous l'axe neutre.
    if (cut > a0) s += (w * (cut - a0) * (pna - (a0 + cut) / 2));
    // Partie au-dessus.
    if (a1 > cut) s += (w * (a1 - cut) * ((cut + a1) / 2 - pna));
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Sections tubulaires — formules fermées exactes                      */
/* ------------------------------------------------------------------ */

/** Caractéristiques d'une couronne circulaire (tube CHS). */
export function chsProps(d: number, t: number): {
  A: number;
  I: number;
  Wel: number;
  Wpl: number;
  It: number;
  perimeter: number;
} {
  const di = d - 2 * t;
  const A = (Math.PI / 4) * (d * d - di * di);
  const I = (Math.PI / 64) * (d ** 4 - di ** 4);
  return {
    A,
    I,
    Wel: (2 * I) / d,
    Wpl: (d ** 3 - di ** 3) / 6,
    It: 2 * I,
    perimeter: Math.PI * d,
  };
}

/**
 * Caractéristiques d'un rectangle plein à coins arrondis (contour extérieur ou
 * intérieur d'un tube carré/rectangulaire).
 * @param B largeur (mm), @param H hauteur (mm), @param r rayon de coin (mm)
 */
export function roundedRectProps(B: number, H: number, r: number): {
  A: number;
  Iy: number;
  Iz: number;
  Sy: number;
  Sz: number;
  perimeter: number;
} {
  const corr = 4 - Math.PI;
  const A = B * H - corr * r * r;

  /** Retrait d'inertie dû aux 4 coins arrondis, pour une profondeur `D`. */
  const cornerI = (D: number): number => {
    const e = D / 2 - r; // distance centre du congé → axe
    const square = r ** 4 / 12 + r * r * (D / 2 - r / 2) ** 2;
    const quarter =
      (Math.PI * r ** 4) / 16 + 2 * e * (r ** 3 / 3) + e * e * ((Math.PI * r * r) / 4);
    return square - quarter;
  };
  /** Retrait de moment statique de demi-section dû aux 2 coins d'un côté. */
  const cornerS = (D: number): number => {
    const e = D / 2 - r;
    const square = r * r * (D / 2 - r / 2);
    const quarter = r ** 3 / 3 + e * ((Math.PI * r * r) / 4);
    return square - quarter;
  };

  return {
    A,
    Iy: (B * H ** 3) / 12 - 4 * cornerI(H),
    Iz: (H * B ** 3) / 12 - 4 * cornerI(B),
    Sy: (B * H * H) / 8 - 2 * cornerS(H),
    Sz: (H * B * B) / 8 - 2 * cornerS(B),
    perimeter: 2 * (H - 2 * r) + 2 * (B - 2 * r) + 2 * Math.PI * r,
  };
}

/**
 * Rayon extérieur d'angle normalisé des profils creux formés à froid
 * (EN 10219-2) en fonction de l'épaisseur.
 */
export function hollowCornerRadius(t: number): number {
  if (t <= 6) return 2 * t;
  if (t <= 10) return 2.5 * t;
  return 3 * t;
}
