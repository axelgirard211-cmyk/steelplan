import { getProfile } from '../../catalog/index';
import type { Hole } from '../../geometry/holes';
import { fibreAbscissa, memberFrame, type Member, type MemberFrame } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { dot, sub, type Vec3 } from '../../math/vec3';
import { pt, type Bbox, type DrawScene, type Layer, type Pt } from '../scene';
import type { Axial, Interet } from './axial';

/**
 * VUES D'UNE BARRE — élévation et faces percées, en vue interrompue.
 *
 * Les faces sont nommées comme dans les fichiers de commande numérique (DSTV) :
 *  - `v` : l'âme, vue de face — c'est l'élévation ;
 *  - `o` : la semelle du côté +z de la section, vue de dessus ;
 *  - `u` : la semelle du côté −z, vue de dessous.
 * ⚠ Le même nom sur le plan et dans le fichier machine : le perceur qui vérifie
 * une pièce sortie de la ligne de perçage sait sur quelle vue regarder.
 */
export type Face = 'v' | 'o' | 'u';

export const LIBELLE_FACE: Readonly<Record<Face, string>> = {
  v: 'ÉLÉVATION — face v (âme)',
  o: 'VUE DE DESSUS — face o',
  u: 'VUE DE DESSOUS — face u',
};

/** Face qui MONTRE un perçage en vraie forme. */
export function faceDuTrou(h: Hole): Face {
  if (h.through === 'y') return 'v';
  return h.at.z >= 0 ? 'o' : 'u';
}

/** Point 3D dans le repère de la barre : abscisse, largeur, hauteur. */
export function dansLaBarre(f: MemberFrame, origine: Vec3, q: Vec3): { s: number; y: number; z: number } {
  const d = sub(q, origine);
  return { s: dot(d, f.ax), y: dot(d, f.ay), z: dot(d, f.az) };
}

/** Encombrement transversal réel de la section (mm), depuis son contour. */
export function encombrementSection(m: Member): { yMin: number; yMax: number; zMin: number; zMax: number } {
  const c = sectionOutline(getProfile(m.profileId), 8).outer;
  return {
    yMin: Math.min(...c.map((q) => q.y)),
    yMax: Math.max(...c.map((q) => q.y)),
    zMin: Math.min(...c.map((q) => q.z)),
    zMax: Math.max(...c.map((q) => q.z)),
  };
}

/** Coordonnée transversale portée verticalement sur le papier, selon la face. */
export function transversale(face: Face, p: { y: number; z: number }): number {
  return face === 'v' ? p.z : face === 'o' ? p.y : -p.y;
}

/** Ce qui est soudé ou posé sur la barre, déjà exprimé dans son repère. */
export interface Accessoire {
  readonly repere: string;
  /** Points du contour, dans le repère de la barre. */
  readonly points: readonly { s: number; y: number; z: number }[];
}

export interface Vue {
  readonly face: Face;
  /** Point papier d'une abscisse et d'une coordonnée transversale. */
  readonly P: (s: number, t: number) => Pt;
  /** Bornes transversales du profil dans cette vue (mm modèle). */
  readonly tMin: number;
  readonly tMax: number;
  /** Emprise papier du dessin, cotes non comprises. */
  readonly cadre: Bbox;
}

/**
 * Trace une vue de la barre. `origine` est le point papier de l'abscisse du
 * début de la barre dessinée, à la cote transversale nulle.
 */
export function dessinerVue(
  s: DrawScene,
  m: Member,
  face: Face,
  ax: Axial,
  origine: Pt,
  accessoires: readonly Accessoire[] = [],
): Vue {
  const profil = getProfile(m.profileId);
  const f = memberFrame(m);
  const e = encombrementSection(m);
  const k = 1 / ax.echelle;
  const [tMin, tMax] = face === 'v' ? [e.zMin, e.zMax] : face === 'o' ? [e.yMin, e.yMax] : [-e.yMax, -e.yMin];
  const s0 = ax.zones[0]?.a ?? 0;
  const P = (sAbs: number, t: number): Pt => pt(origine.x + ax.x(sAbs) - ax.x(s0), origine.y + t * k);

  // Abscisse de l'about sur la fibre vue au bord haut ou bas de la vue.
  const fibre = (t: number): { y: number; z: number } =>
    face === 'v' ? { y: 0, z: t } : face === 'o' ? { y: t, z: e.zMax } : { y: -t, z: e.zMin };
  const about = (t: number, cote: 'start' | 'end'): number =>
    fibreAbscissa(f, m.start, cote === 'start' ? m.cutStart : m.cutEnd, fibre(t));

  /* --- Contour, zone par zone --- */
  const zones = ax.zones;
  zones.forEach((z, i) => {
    for (const t of [tMin, tMax]) {
      const a = Math.max(z.a, about(t, 'start'));
      const b = Math.min(z.b, about(t, 'end'));
      if (b > a) s.ligne(P(a, t), P(b, t), 'contour');
    }
    if (i === 0) s.ligne(P(about(tMin, 'start'), tMin), P(about(tMax, 'start'), tMax), 'contour');
    if (i === zones.length - 1) s.ligne(P(about(tMin, 'end'), tMin), P(about(tMax, 'end'), tMax), 'contour');
    // Interruptions : un trait brisé à chaque bord de coupure.
    if (i > 0) traitDInterruption(s, P(z.a, tMin), P(z.a, tMax));
    if (i < zones.length - 1) traitDInterruption(s, P(z.b, tMin), P(z.b, tMax));
  });

  /* --- Arêtes intérieures : semelles en élévation, âme cachée en plan --- */
  const lignesInterieures: { t: number; layer: Layer }[] = [];
  if (profil.shape === 'I' || profil.shape === 'U') {
    if (face === 'v') {
      lignesInterieures.push({ t: tMax - profil.tf, layer: 'contour-fin' }, { t: tMin + profil.tf, layer: 'contour-fin' });
    } else if (profil.shape === 'I') {
      lignesInterieures.push({ t: -profil.tw / 2, layer: 'cachee' }, { t: profil.tw / 2, layer: 'cachee' });
    }
  }
  for (const { t, layer } of lignesInterieures) {
    for (const z of zones) {
      const a = Math.max(z.a, about(t, 'start'));
      const b = Math.min(z.b, about(t, 'end'));
      if (b > a) s.ligne(P(a, t), P(b, t), layer);
    }
  }
  // Axe de la pièce, de bout en bout.
  if (face === 'v') {
    const premier = zones[0] as Interet;
    const dernier = zones[zones.length - 1] as Interet;
    s.ligne(P(premier.a, 0), P(dernier.b, 0), 'axe');
  }

  /* --- Perçages : ceux des zones dessinées ; l'interruption n'en montre aucun --- */
  const dansUneZone = (sAbs: number): boolean => zones.some((z) => sAbs >= z.a - 1e-6 && sAbs <= z.b + 1e-6);
  for (const h of m.holes) {
    if (!dansUneZone(h.s)) continue;
    const t = transversale(face, h.at);
    if (faceDuTrou(h) === face) {
      dessinerTrou(s, P(h.s, t), (h.d / 2) * k);
    } else if (face === 'v' && h.through === 'z') {
      // Vu de profil, un trou de semelle n'est qu'un axe à travers la semelle.
      const c = P(h.s, h.at.z);
      s.ligne(pt(c.x, c.y - 2), pt(c.x, c.y + 2), 'axe');
    }
  }

  /* --- Grugeages, en élévation --- */
  if (face === 'v') {
    for (const n of m.notches) {
      const tExt = n.side === 'sup' ? tMax : tMin;
      const tInt = n.side === 'sup' ? tMax - n.depth : tMin + n.depth;
      s.polyligne([P(n.s0, tExt), P(n.s0, tInt), P(n.s1, tInt), P(n.s1, tExt)], false, 'contour');
    }
  }

  /* --- Tôles, jarrets et pièces soudées à leur place --- */
  for (const acc of accessoires) {
    const pts = acc.points.map((q) => P(q.s, transversale(face, q)));
    s.polyligne(enveloppe(pts), true, 'contour');
  }

  const xs = [P(about(tMin, 'start'), 0).x, P(about(tMin, 'end'), 0).x, P(about(tMax, 'start'), 0).x, P(about(tMax, 'end'), 0).x];
  const ts = [tMin, tMax, ...accessoires.flatMap((a) => a.points.map((q) => transversale(face, q)))];
  return {
    face,
    P,
    tMin,
    tMax,
    cadre: {
      min: pt(Math.min(...xs), origine.y + Math.min(...ts) * k),
      max: pt(Math.max(...xs), origine.y + Math.max(...ts) * k),
    },
  };
}

/** Perçage : cercle en vraie grandeur et croix d'axe. */
export function dessinerTrou(s: DrawScene, centre: Pt, rayon: number): void {
  s.cercle(centre, Math.max(rayon, 0.4), 'contour');
  const t = Math.max(rayon + 1.5, 2);
  s.ligne(pt(centre.x - t, centre.y), pt(centre.x + t, centre.y), 'axe');
  s.ligne(pt(centre.x, centre.y - t), pt(centre.x, centre.y + t), 'axe');
}

/**
 * Trait d'interruption (NF EN ISO 128) : un trait fin brisé en zigzag, qui dit
 * que la pièce continue au-delà sans rien qui mérite d'être dessiné.
 */
function traitDInterruption(s: DrawScene, a: Pt, b: Pt): void {
  const h = b.y - a.y;
  const pas = 1.6;
  s.polyligne(
    [
      pt(a.x, a.y - 1.5),
      pt(a.x, a.y + h * 0.4),
      pt(a.x - pas, a.y + h * 0.47),
      pt(a.x + pas, a.y + h * 0.53),
      pt(a.x, a.y + h * 0.6),
      pt(a.x, b.y + 1.5),
    ],
    false,
    'contour-fin',
  );
}

/** Enveloppe convexe (Andrew), pour tracer la silhouette d'un accessoire. */
function enveloppe(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const croix = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const bas: Pt[] = [];
  for (const q of p) {
    while (bas.length >= 2 && croix(bas[bas.length - 2] as Pt, bas[bas.length - 1] as Pt, q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (haut.length >= 2 && croix(haut[haut.length - 2] as Pt, haut[haut.length - 1] as Pt, q) <= 0) haut.pop();
    haut.push(q);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}
