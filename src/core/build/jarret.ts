import { getProfile } from '../catalog/index';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import { RHO_ACIER } from '../math/tolerance';
import type { Haunch } from './types';

/**
 * CONTOUR D'UN JARRET — l'unique définition de sa forme.
 *
 * ⚠ Elle était écrite quatre fois, et quatre fois différemment : la vue 3D
 * mesurait la hauteur perpendiculairement à la traverse, le détail et la coupe
 * verticalement, et la fiche de fabrication la faisait partir de l'AXE de la
 * traverse au lieu de sa semelle basse — une demi-hauteur de profil d'écart sur
 * le plan même d'après lequel on découpe la pièce.
 *
 * Le jarret est un triangle d'âme bordé d'une semelle sur l'hypoténuse :
 *  - `haut`   : racine, sous la semelle inférieure de la traverse ;
 *  - `bas`    : racine, au bas du renfort — `rootDepth` plus loin suivant `down` ;
 *  - `pointe` : extrémité, sous la semelle inférieure de la traverse.
 *
 * La racine suit `down` : verticale au genou, pour s'appliquer d'aplomb contre la
 * platine d'about. Perpendiculaire à la traverse, elle laissait un coin vide de
 * cinq centimètres au bas de la platine — là où le cordon devait être déposé.
 */
export interface ContourJarret {
  readonly haut: Vec3;
  readonly bas: Vec3;
  readonly pointe: Vec3;
}

export function contourJarret(h: Haunch): ContourJarret {
  const hTraverse = getProfile(h.profileId).h;
  const ax = normalize(sub(h.tip, h.root));
  const down = normalize(h.down);
  // Normale de la traverse, vers le haut de sa section : la composante de −down
  // perpendiculaire à l'axe.
  const n = normalize(sub(scale(down, -1), scale(ax, dot(scale(down, -1), ax))));
  const cos = Math.max(0.2, -dot(down, n));
  const haut = add(h.root, scale(down, hTraverse / 2 / cos));
  return {
    haut,
    bas: add(haut, scale(down, h.rootDepth)),
    pointe: sub(h.tip, scale(n, hTraverse / 2)),
  };
}

/** Longueur de la semelle du jarret, de la racine à la pointe (mm). */
export function longueurSemelleJarret(h: Haunch): number {
  const c = contourJarret(h);
  return length(sub(c.pointe, c.bas));
}

/** Aire du triangle d'âme (mm²). */
function aireAme(h: Haunch): number {
  const c = contourJarret(h);
  return length(cross(sub(c.bas, c.haut), sub(c.pointe, c.haut))) / 2;
}

/**
 * Masse d'un jarret : triangle d'âme + semelle suivant l'hypoténuse. La semelle
 * supérieure du tronçon découpé n'existe pas — c'est celle de la traverse qui
 * la remplace.
 */
export function haunchMassKg(h: Haunch): number {
  const profil = getProfile(h.profileId);
  if (profil.shape !== 'I') return 0;
  const semelle = longueurSemelleJarret(h);
  const ame = Math.max(0, aireAme(h) - profil.tf * semelle) * profil.tw;
  return (ame + semelle * profil.b * profil.tf) * RHO_ACIER;
}

/** Surface à peindre d'un jarret (m²) : les deux faces d'âme + la semelle. */
export function haunchPaintM2(h: Haunch): number {
  const profil = getProfile(h.profileId);
  if (profil.shape !== 'I') return 0;
  const semelle = longueurSemelleJarret(h);
  return (2 * aireAme(h) + semelle * (2 * profil.b + 2 * profil.tf)) / 1e6;
}
