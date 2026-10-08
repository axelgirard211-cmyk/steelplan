import type { Profile } from '../catalog/types';

/**
 * Grugeages et becquets.
 *
 * Un GRUGEAGE est un enlèvement de matière sur une fibre extrême de la pièce,
 * sur une portion de sa longueur : on entaille une semelle pour dégager la
 * semelle de la pièce qu'on vient buter, ou pour laisser passer un cordon de
 * soudure. Un BECQUET est le même geste au voisinage immédiat d'un about.
 *
 * Comme les perçages, un grugeage est repéré DANS LE SYSTÈME DE LA PIÈCE —
 * abscisse depuis l'about d'origine et profondeur depuis la fibre concernée. Le
 * débiteur trace au mètre depuis le bout de la barre, pas dans un repère
 * absolu.
 */

/** Fibre entamée par le grugeage, dans le repère de section (y largeur, z hauteur). */
export type NotchSide = 'sup' | 'inf' | 'gauche' | 'droite';

export interface Notch {
  /** Abscisse de début, depuis l'about d'origine (mm). */
  readonly s0: number;
  /** Abscisse de fin (mm). */
  readonly s1: number;
  /** Profondeur enlevée depuis la fibre concernée (mm). */
  readonly depth: number;
  readonly side: NotchSide;
  /** Motif du grugeage, reporté sur le plan de débit. */
  readonly reason: string;
}

export function notch(
  s0: number,
  s1: number,
  depth: number,
  side: NotchSide,
  reason: string,
): Notch {
  return { s0: Math.min(s0, s1), s1: Math.max(s0, s1), depth, side, reason };
}

/**
 * Aire de section retirée par un grugeage de profondeur `depth` sur la fibre
 * indiquée (mm²).
 *
 * Exact pour les profils en I et en U, les seuls qu'on grugue en pratique :
 * jusqu'à l'épaisseur de semelle on enlève la semelle entière, au-delà on
 * attaque l'âme. Renvoie 0 pour les autres formes, où le grugeage n'a pas de
 * sens et ne doit donc pas peser dans les masses.
 */
export function notchedArea(profile: Profile, side: NotchSide, depth: number): number {
  if (profile.shape !== 'I' && profile.shape !== 'U') return 0;
  const d = Math.max(0, depth);

  if (side === 'sup' || side === 'inf') {
    const semelle = Math.min(d, profile.tf) * profile.b;
    const ame = Math.max(0, d - profile.tf) * profile.tw;
    return semelle + ame;
  }
  // Grugeage sur un chant : on entame les deux semelles sur la profondeur.
  return 2 * Math.min(d, profile.b) * profile.tf;
}

/** Volume total retiré par une liste de grugeages (mm³). */
export function notchedVolume(profile: Profile, notches: readonly Notch[]): number {
  return notches.reduce(
    (v, n) => v + notchedArea(profile, n.side, n.depth) * Math.max(0, n.s1 - n.s0),
    0,
  );
}

/** Signature d'un jeu de grugeages, pour le repérage des pièces. */
export function notchSignature(notches: readonly Notch[]): string {
  return [...notches]
    .map((n) => `${Math.round(n.s0)}-${Math.round(n.s1)}:${Math.round(n.depth)}:${n.side}`)
    .sort()
    .join(',');
}
