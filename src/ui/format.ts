/**
 * Formatage à la française : virgule décimale, espace fine insécable pour les
 * milliers. Les valeurs internes sont en mm ; les conversions d'affichage
 * (cm², cm⁴, m) sont regroupées ici et nulle part ailleurs.
 */

const nf = (min: number, max: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max });

const f0 = nf(0, 0);
const f1 = nf(1, 1);
const f2 = nf(2, 2);
const f3 = nf(0, 3);

/** Nombre avec `d` décimales fixes. */
export function num(v: number, d = 0): string {
  return d === 0 ? f0.format(v) : d === 1 ? f1.format(v) : d === 2 ? f2.format(v) : f3.format(v);
}

/** Longueur en mm, telle qu'elle sera cotée. */
export function mm(v: number): string {
  return f0.format(Math.round(v));
}

/** Longueur en mm affichée en mètres. */
export function metres(v: number, d = 2): string {
  return nf(d, d).format(v / 1000);
}

/** Aire mm² → cm². */
export function cm2(v: number): string {
  return f2.format(v / 100);
}

/** Module mm³ → cm³. */
export function cm3(v: number): string {
  const c = v / 1e3;
  return c >= 1000 ? f0.format(c) : f1.format(c);
}

/** Inertie mm⁴ → cm⁴. */
export function cm4(v: number): string {
  const c = v / 1e4;
  return c >= 1000 ? f0.format(c) : c >= 10 ? f1.format(c) : f2.format(c);
}

/** Longueur mm → cm (rayons de giration). */
export function cm(v: number): string {
  return f2.format(v / 10);
}

/** Masse en kg. */
export function kg(v: number): string {
  return f1.format(v);
}

/** Épaisseur ou petite dimension, au dixième si nécessaire. */
export function dim(v: number): string {
  return Number.isInteger(v) ? f0.format(v) : f1.format(v);
}

/** Périmètre mm → m²/m (surface développée par mètre linéaire). */
export function m2parM(v: number): string {
  return f3.format(v / 1000);
}
