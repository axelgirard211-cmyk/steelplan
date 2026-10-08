/**
 * Tolérances et arrondis.
 *
 * Convention d'unités du moteur : TOUT est en mm (longueurs), mm² (aires),
 * mm³ (modules), mm⁴ (inerties), N (efforts), N·mm (moments), kg (masses).
 * Les conversions (m à la saisie, cm⁴ dans les catalogues) sont faites
 * uniquement aux frontières : import catalogue, formulaires, affichage.
 */

/** Tolérance géométrique générale (mm). En dessous, deux points sont confondus. */
export const EPS = 1e-6;

/** Tolérance angulaire générale (radians) ≈ 0,00006°. */
export const EPS_ANGLE = 1e-9;

/** Deux longueurs sont-elles égales à la tolérance près ? */
export function eq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

/** Zéro à la tolérance près. */
export function isZero(a: number, eps = EPS): boolean {
  return Math.abs(a) <= eps;
}

/**
 * Arrondi de fabrication : les cotes portées sur un plan d'atelier sont
 * arrondies au millimètre. Utiliser UNIQUEMENT à l'affichage / cotation,
 * jamais dans une chaîne de calcul (l'erreur s'accumulerait).
 */
export function roundMm(v: number): number {
  return Math.round(v);
}

/** Arrondi au dixième de mm (perçages, épaisseurs de tôle). */
export function roundTenth(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Arrondi à `n` décimales, sans artefact binaire. */
export function roundTo(v: number, n: number): number {
  const f = 10 ** n;
  return Math.round(v * f + Number.EPSILON * Math.sign(v) * f) / f;
}

/** Borne une valeur dans [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Degrés → radians. */
export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Radians → degrés. */
export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Facteurs de conversion vers les unités internes (mm). */
export const UNITS = {
  /** mètres → mm */
  m2mm: 1000,
  /** cm → mm */
  cm2mm: 10,
  /** cm² → mm² */
  cm2ToMm2: 100,
  /** cm³ → mm³ */
  cm3ToMm3: 1000,
  /** cm⁴ → mm⁴ */
  cm4ToMm4: 10_000,
} as const;

/** Masse volumique de l'acier de construction (kg/mm³). */
export const RHO_ACIER = 7850 / 1e9;
