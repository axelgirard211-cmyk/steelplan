/**
 * CADRAGE DE L'ÉDITEUR — la fenêtre de la feuille affichée à l'écran.
 *
 * La vue est un rectangle en millimètres SVG (Y vers le bas, origine en haut à
 * gauche de la feuille), aux proportions exactes du cadre d'affichage : le
 * pointeur se convertit ainsi en point de feuille par une simple règle de trois,
 * sans bande vide à gérer sur les bords.
 */

export interface Vue {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Vue qui montre toute la feuille, avec une marge, dans un cadre de `l × hc` px. */
export function vueEtendue(largeurFeuille: number, hauteurFeuille: number, l: number, hc: number, marge = 1.04): Vue {
  const rapport = hc / Math.max(1, l);
  let w = largeurFeuille * marge;
  let h = w * rapport;
  if (h < hauteurFeuille * marge) {
    h = hauteurFeuille * marge;
    w = h / rapport;
  }
  return { x: (largeurFeuille - w) / 2, y: (hauteurFeuille - h) / 2, w, h };
}

/** Recale la hauteur de la vue sur les proportions d'un nouveau cadre. */
export function auxProportions(v: Vue, l: number, hc: number): Vue {
  const h = v.w * (hc / Math.max(1, l));
  return { ...v, y: v.y + (v.h - h) / 2, h };
}

/** Point SVG sous un pixel du cadre. */
export function versFeuille(v: Vue, px: number, py: number, l: number, hc: number): { x: number; y: number } {
  return { x: v.x + (px / Math.max(1, l)) * v.w, y: v.y + (py / Math.max(1, hc)) * v.h };
}

const ZOOM_MAXI = 0.5; // largeur de vue minimale (mm) : au-delà, plus rien à lire
const ZOOM_MINI = 5000;

/** Zoom de facteur `f` (< 1 : on se rapproche) autour d'un point SVG qui reste sous le pointeur. */
export function zoomer(v: Vue, f: number, cx: number, cy: number): Vue {
  const w = Math.min(ZOOM_MINI, Math.max(ZOOM_MAXI, v.w * f));
  const k = w / v.w;
  return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k };
}

/** Déplacement de la vue, en pixels de l'écran. */
export function deplacer(v: Vue, dxPx: number, dyPx: number, l: number): Vue {
  const k = v.w / Math.max(1, l);
  return { ...v, x: v.x - dxPx * k, y: v.y - dyPx * k };
}

/** Millimètres de feuille par pixel d'écran. */
export const mmParPixel = (v: Vue, l: number): number => v.w / Math.max(1, l);
