import { getProfile } from '../../catalog/index';
import { contourJarret } from '../../build/jarret';
import type { Haunch } from '../../build/types';
import { memberFrame, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { add, scale, type Vec3 } from '../../math/vec3';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import { appliquer, project, type Transform2D, type ViewDir } from '../view';
import { silhouette } from './ensemble';

/**
 * TRACÉ ET ÉTIQUETAGE DES VUES DE REPÉRAGE.
 *
 * ⚠ Les repères s'écrivaient SUR les barres, en travers des traits : « TR1B »
 * se lisait barré par l'âme de la traverse, « PO1A » par les lisses. Chaque
 * étiquette est ici posée sur un MASQUE de la couleur du papier, qui coupe les
 * traits sous elle, et déplacée le long de sa pièce quand elle en toucherait une
 * autre.
 */

/** Hauteur du texte des repères sur un plan de repérage (mm papier). */
export const H_REPERE = 2.2;

export interface Etiquette {
  readonly texte: string;
  /** Point d'attache préféré, sur la pièce (papier). */
  readonly ancre: Pt;
  /** Direction de la pièce sur le papier, pour glisser le long d'elle. */
  readonly le: Pt;
  /** Longueur papier de la pièce : jusqu'où l'étiquette peut glisser. */
  readonly longueur: number;
}

/** Boîte qu'occupe un texte centré en `c`. */
function boiteDe(c: Pt, texte: string, h = H_REPERE): Bbox {
  const l = texte.length * 0.62 * h + 1.2;
  return { min: pt(c.x - l / 2, c.y - h / 2 - 0.6), max: pt(c.x + l / 2, c.y + h / 2 + 0.6) };
}

const seTouchent = (a: Bbox, b: Bbox): boolean =>
  a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y;

/**
 * Pose les étiquettes sans chevauchement : sur la pièce d'abord, puis glissées
 * le long d'elle, puis à côté avec un trait de rappel. Renvoie celles qu'on n'a
 * pas pu poser — jamais en silence : l'appelant les compte.
 */
export function poserEtiquettes(s: DrawScene, etiquettes: readonly Etiquette[], occupe: Bbox[] = []): string[] {
  const refusees: string[] = [];
  for (const e of etiquettes) {
    const glisse = [0, 0.22, -0.22, 0.36, -0.36].map((k) => pt(e.ancre.x + e.le.x * k * e.longueur, e.ancre.y + e.le.y * k * e.longueur));
    const nrm = pt(-e.le.y, e.le.x);
    const cotes = [5, -5, 9, -9].map((k) => pt(e.ancre.x + nrm.x * k, e.ancre.y + nrm.y * k));
    let pose: Pt | null = null;
    let rappel = false;
    for (const c of [...glisse, ...cotes]) {
      if (occupe.some((b) => seTouchent(b, boiteDe(c, e.texte)))) continue;
      pose = c;
      rappel = cotes.includes(c);
      break;
    }
    if (!pose) {
      refusees.push(e.texte);
      continue;
    }
    const b = boiteDe(pose, e.texte);
    occupe.push(b);
    if (rappel) s.ligne(e.ancre, pose, 'reperage');
    // Masque de la couleur du papier : il coupe les traits sous le repère.
    s.remplissage([b.min, pt(b.max.x, b.min.y), b.max, pt(b.min.x, b.max.y)], [], 1, 'texte');
    s.texte(pose, e.texte, { hauteur: H_REPERE, gras: true, ancrage: 'centre', ligneDeBase: 'milieu', layer: 'reperage' });
  }
  return refusees;
}

/** Étiquette d'une barre vue en long, ancrée au milieu de sa silhouette. */
export function etiquetteDeBarre(t: Transform2D, m: Member, v: ViewDir, texte: string, position = 0.5): Etiquette | null {
  const a = appliquer(t, project(m.start, v));
  const b = appliquer(t, project(m.end, v));
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1.5) return null;
  return {
    texte,
    ancre: pt(a.x + (b.x - a.x) * position, a.y + (b.y - a.y) * position),
    le: pt((b.x - a.x) / l, (b.y - a.y) / l),
    longueur: l,
  };
}

/** Une barre vue en long : sa silhouette, trait fort pour l'ossature principale. */
export function tracerBarre(s: DrawScene, t: Transform2D, m: Member, v: ViewDir, fort: boolean): void {
  const sil = silhouette(m, v);
  if (sil.length >= 3) s.polyligne(sil.map((q) => appliquer(t, q)), true, fort ? 'contour' : 'contour-fin');
}

/** Une barre vue en bout : le contour de sa section. */
export function tracerSection(s: DrawScene, t: Transform2D, m: Member, v: ViewDir, ou: Vec3 = m.start): void {
  const f = memberFrame(m);
  const contour = sectionOutline(getProfile(m.profileId), 4).outer.map((q) =>
    appliquer(t, project(add(ou, add(scale(f.ay, q.y), scale(f.az, q.z))), v)),
  );
  s.polyligne(contour, true, 'contour');
}

/** Un jarret, dans le plan du portique. */
export function tracerJarret(s: DrawScene, t: Transform2D, j: Haunch, v: ViewDir): void {
  const k = contourJarret(j);
  s.polyligne([k.haut, k.bas, k.pointe].map((q) => appliquer(t, project(q, v))), true, 'contour');
}

/** Bulle d'axe : un cercle et sa lettre ou son numéro. */
export function bulleDAxe(s: DrawScene, c: Pt, texte: string): void {
  s.cercle(c, 4, 'reperage');
  s.texte(c, texte, { hauteur: 2.6, gras: true, ancrage: 'centre', ligneDeBase: 'milieu', layer: 'reperage' });
}

/** La barre est-elle vue en bout dans cette vue ? */
export function vueEnBout(m: Member, v: ViewDir): boolean {
  const a = project(m.start, v);
  const b = project(m.end, v);
  return Math.hypot(b.x - a.x, b.y - a.y) < 1;
}
