import { cross, dot, normalize, scale as vscale, sub, EX, EY, EZ, type Vec3 } from '../math/vec3';
import { pt, type Bbox, type Pt } from './scene';

/**
 * Projection du modèle 3D vers le plan du dessin.
 *
 * Une vue est un repère orthonormé : une origine, une direction « droite » et une
 * direction « haut ». Projeter, c'est mesurer les deux composantes du point dans
 * ce repère — rien de plus. Toute la 2D du logiciel passe par ici, ce qui rend
 * les vues normalisées (plan, élévation, coupe) rigoureusement cohérentes entre
 * elles : ce sont les mêmes points, lus dans des repères différents.
 */
export interface ViewDir {
  readonly origin: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/** Projette un point du modèle dans le plan de la vue (mm modèle). */
export function project(p: Vec3, v: ViewDir): Pt {
  const d = sub(p, v.origin);
  return pt(dot(d, v.right), dot(d, v.up));
}

/** Normale sortante de la vue : la direction d'où l'on regarde. */
export function viewNormal(v: ViewDir): Vec3 {
  return normalize(cross(v.right, v.up));
}

/** Profondeur d'un point derrière le plan de la vue, pour trier les recouvrements. */
export function depth(p: Vec3, v: ViewDir): number {
  return dot(sub(p, v.origin), viewNormal(v));
}

const ORIGINE: Vec3 = { x: 0, y: 0, z: 0 };

/** Vue en plan : on regarde le bâtiment du dessus. X à droite, Y vers le haut. */
export const VUE_PLAN: ViewDir = { origin: ORIGINE, right: EX, up: EY };

/** Élévation de long pan : X à droite, Z vers le haut. */
export const VUE_LONG_PAN: ViewDir = { origin: ORIGINE, right: EX, up: EZ };

/** Coupe transversale (vue de pignon) : Y à droite, Z vers le haut. */
export const VUE_TRANSVERSALE: ViewDir = { origin: ORIGINE, right: EY, up: EZ };

/**
 * Vue propre à une pièce, pour son plan de débit : l'axe de la pièce est
 * horizontal et sa hauteur de section verticale. C'est ainsi qu'un débiteur
 * regarde une barre posée sur ses tréteaux.
 */
export function vuePiece(origin: Vec3, axe: Vec3, hauteur: Vec3): ViewDir {
  const right = normalize(axe);
  const up = normalize(sub(hauteur, vscale(right, dot(hauteur, right))));
  return { origin, right, up };
}

/* ------------------------------------------------------------------ */
/* Transformation modèle → papier                                      */
/* ------------------------------------------------------------------ */

/**
 * Passage des millimètres MODÈLE aux millimètres PAPIER.
 * `papier = modèle × facteur + décalage`, avec `facteur = 1 / dénominateur`
 * d'échelle : à l'échelle 1:50, un mètre de bâtiment fait 20 mm sur la feuille.
 */
export interface Transform2D {
  readonly facteur: number;
  readonly dx: number;
  readonly dy: number;
}

export function appliquer(t: Transform2D, p: Pt): Pt {
  return pt(p.x * t.facteur + t.dx, p.y * t.facteur + t.dy);
}

/** Longueur papier d'une longueur modèle. */
export function longueurPapier(t: Transform2D, l: number): number {
  return l * t.facteur;
}

/**
 * Transformation qui centre une emprise modèle dans une fenêtre papier, à une
 * échelle imposée. L'échelle n'est JAMAIS ajustée pour faire entrer le dessin :
 * un plan doit être à une échelle normalisée, sinon il n'est pas mesurable.
 */
export function cadrer(emprise: Bbox, fenetre: Bbox, denominateur: number): Transform2D {
  const facteur = 1 / denominateur;
  const largeurModele = (emprise.max.x - emprise.min.x) * facteur;
  const hauteurModele = (emprise.max.y - emprise.min.y) * facteur;
  const largeurFenetre = fenetre.max.x - fenetre.min.x;
  const hauteurFenetre = fenetre.max.y - fenetre.min.y;
  return {
    facteur,
    dx: fenetre.min.x + (largeurFenetre - largeurModele) / 2 - emprise.min.x * facteur,
    dy: fenetre.min.y + (hauteurFenetre - hauteurModele) / 2 - emprise.min.y * facteur,
  };
}

/** Emprise projetée d'un nuage de points du modèle. */
export function empriseProjetee(points: readonly Vec3[], v: ViewDir): Bbox {
  if (points.length === 0) return { min: pt(0, 0), max: pt(0, 0) };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const q = project(p, v);
    if (q.x < x0) x0 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.x > x1) x1 = q.x;
    if (q.y > y1) y1 = q.y;
  }
  return { min: pt(x0, y0), max: pt(x1, y1) };
}
