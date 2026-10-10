import type { EntiteDessin } from './retouches';
import { pt, type Bbox, type DrawEntity, type Pt } from './scene';

/**
 * GÉOMÉTRIE DE L'ÉDITEUR DE PLANCHES — tout en millimètres papier.
 *
 * Transformations (déplacer, tourner, symétriser, mettre à l'échelle), distance
 * d'un point à une entité pour la désigner au pointeur, emprise pour la
 * sélection par fenêtre, et points d'accrochage. Rien ici ne connaît l'écran.
 */

export type Transfo = (p: Pt) => Pt;

/** Transformation affine décrite par son action sur un point, ses angles et ses longueurs. */
export interface Affine {
  readonly point: Transfo;
  /** Rotation apportée aux directions (rad), pour les textes et les hachures. */
  readonly rotation: number;
  /** Facteur appliqué aux longueurs : rayons, hauteurs de texte. */
  readonly facteur: number;
  /** Symétrie : inverse le sens des arcs. */
  readonly miroir: boolean;
}

export const translation = (dx: number, dy: number): Affine => ({
  point: (p) => pt(p.x + dx, p.y + dy),
  rotation: 0,
  facteur: 1,
  miroir: false,
});

export function rotationAutour(c: Pt, angle: number): Affine {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return {
    point: (p) => pt(c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, c.y + (p.x - c.x) * sn + (p.y - c.y) * cs),
    rotation: angle,
    facteur: 1,
    miroir: false,
  };
}

export function homothetie(c: Pt, k: number): Affine {
  return { point: (p) => pt(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k), rotation: 0, facteur: Math.abs(k), miroir: false };
}

/** Symétrie par rapport à la droite (a, b). */
export function symetrie(a: Pt, b: Pt): Affine {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / l;
  const uy = (b.y - a.y) / l;
  const theta = Math.atan2(uy, ux);
  return {
    point: (p) => {
      const t = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const hx = a.x + ux * t;
      const hy = a.y + uy * t;
      return pt(2 * hx - p.x, 2 * hy - p.y);
    },
    rotation: 2 * theta,
    facteur: 1,
    miroir: true,
  };
}

const DEG = 180 / Math.PI;

/** Applique une transformation à une entité du dessinateur. */
export function transformer(e: EntiteDessin, t: Affine): EntiteDessin {
  const P = t.point;
  switch (e.kind) {
    case 'ligne':
      return { ...e, a: P(e.a), b: P(e.b) };
    case 'polyligne':
      return { ...e, points: e.points.map(P) };
    case 'cercle':
      return { ...e, c: P(e.c), r: e.r * t.facteur };
    case 'arc': {
      // Le départ suit la transformation, le balayage garde sa valeur — signée :
      // une symétrie inverse le sens de parcours.
      const c = P(e.c);
      const p0 = P(pt(e.c.x + e.r * Math.cos(e.a0), e.c.y + e.r * Math.sin(e.a0)));
      const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
      const balayage = (e.a1 - e.a0) * (t.miroir ? -1 : 1);
      return { ...e, c, r: e.r * t.facteur, a0, a1: a0 + balayage };
    }
    case 'texte':
      // ⚠ Une symétrie ne retourne pas le texte : il resterait illisible.
      // Comme le réglage par défaut des logiciels de DAO, seul son point suit.
      return {
        ...e,
        at: P(e.at),
        hauteur: e.hauteur * t.facteur,
        rotation: t.miroir ? e.rotation : e.rotation + t.rotation * DEG,
      };
    case 'hachure':
      return {
        ...e,
        contour: e.contour.map(P),
        trous: e.trous.map((r) => r.map(P)),
        pas: e.pas,
        angle: t.miroir ? t.rotation * DEG - e.angle : e.angle + t.rotation * DEG,
      };
    case 'remplissage':
      return { ...e, contour: e.contour.map(P), trous: e.trous.map((r) => r.map(P)) };
    case 'cote':
      return t.miroir
        ? { ...e, a: P(e.b), b: P(e.a), decalage: e.decalage * t.facteur }
        : { ...e, a: P(e.a), b: P(e.b), decalage: e.decalage * t.facteur };
  }
}

/* ------------------------------------------------------------------ */
/* Emprise et désignation                                              */
/* ------------------------------------------------------------------ */

/** Largeur moyenne d'un caractère, en fraction de la hauteur de texte. */
const LARGEUR_CARACTERE = 0.62;

/** Les quatre coins d'un texte sur le papier. */
export function coinsDuTexte(e: Extract<DrawEntity, { kind: 'texte' }>): Pt[] {
  const l = e.texte.length * LARGEUR_CARACTERE * e.hauteur;
  const h = e.hauteur;
  const x0 = e.ancrage === 'gauche' ? 0 : e.ancrage === 'centre' ? -l / 2 : -l;
  const y0 = e.ligneDeBase === 'bas' ? 0 : e.ligneDeBase === 'milieu' ? -h / 2 : -h;
  const a = (e.rotation * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [
    [x0, y0],
    [x0 + l, y0],
    [x0 + l, y0 + h],
    [x0, y0 + h],
  ].map(([x, y]) => pt(e.at.x + (x as number) * cs - (y as number) * sn, e.at.y + (x as number) * sn + (y as number) * cs));
}

/** Points qui bornent une entité (pour son emprise). */
function pointsDe(e: DrawEntity): Pt[] {
  switch (e.kind) {
    case 'ligne':
      return [e.a, e.b];
    case 'polyligne':
      return [...e.points];
    case 'cercle':
    case 'arc':
      return [pt(e.c.x - e.r, e.c.y - e.r), pt(e.c.x + e.r, e.c.y + e.r)];
    case 'texte':
      return coinsDuTexte(e);
    case 'hachure':
    case 'remplissage':
      return [...e.contour];
  }
}

export function emprise(traits: readonly DrawEntity[]): Bbox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of traits) {
    for (const p of pointsDe(t)) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return { min: pt(x0, y0), max: pt(x1, y1) };
}

export function distanceAuSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsDe(l: readonly Pt[], fermee: boolean): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < l.length; i++) out.push([l[i] as Pt, l[i + 1] as Pt]);
  if (fermee && l.length > 2) out.push([l[l.length - 1] as Pt, l[0] as Pt]);
  return out;
}

function dansLePolygone(p: Pt, poly: readonly Pt[]): boolean {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans;
  }
  return dedans;
}

/** L'angle est-il balayé par l'arc ? Le balayage peut être de signe quelconque. */
const dansLArc = (ang: number, a0: number, a1: number): boolean => {
  const debut = Math.min(a0, a1);
  const fin = Math.max(a0, a1);
  let a = ang;
  while (a < debut) a += 2 * Math.PI;
  while (a >= debut + 2 * Math.PI) a -= 2 * Math.PI;
  return a <= fin + 1e-9;
};

/** Distance d'un point à une entité : c'est elle qui désigne l'entité sous le pointeur. */
export function distanceA(p: Pt, e: DrawEntity): number {
  switch (e.kind) {
    case 'ligne':
      return distanceAuSegment(p, e.a, e.b);
    case 'polyligne':
      return Math.min(...segmentsDe(e.points, e.fermee).map(([a, b]) => distanceAuSegment(p, a, b)));
    case 'cercle':
      return Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r);
    case 'arc': {
      const ang = Math.atan2(p.y - e.c.y, p.x - e.c.x);
      if (dansLArc(ang, e.a0, e.a1)) return Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r);
      const ext = [e.a0, e.a1].map((a) => pt(e.c.x + e.r * Math.cos(a), e.c.y + e.r * Math.sin(a)));
      return Math.min(...ext.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    }
    case 'texte': {
      const c = coinsDuTexte(e);
      return dansLePolygone(p, c) ? 0 : Math.min(...segmentsDe(c, true).map(([a, b]) => distanceAuSegment(p, a, b)));
    }
    case 'hachure':
    case 'remplissage':
      // Par le bord seulement : un masque blanc sous un repère ne doit pas
      // capter chaque clic posé sur la zone qu'il recouvre.
      return Math.min(...segmentsDe(e.contour, true).map(([a, b]) => distanceAuSegment(p, a, b)));
  }
}

const dansLaBoite = (p: Pt, b: Bbox): boolean => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y;

export function boitesSeTouchent(a: Bbox, b: Bbox): boolean {
  return a.min.x <= b.max.x && b.min.x <= a.max.x && a.min.y <= b.max.y && b.min.y <= a.max.y;
}

/** L'entité est-elle ENTIÈREMENT dans la fenêtre ? (fenêtre tirée vers la droite) */
export function contenuDans(traits: readonly DrawEntity[], f: Bbox): boolean {
  const e = emprise(traits);
  return dansLaBoite(e.min, f) && dansLaBoite(e.max, f);
}

/** L'entité touche-t-elle la fenêtre ? (fenêtre de capture, tirée vers la gauche) */
export function toucheLaFenetre(traits: readonly DrawEntity[], f: Bbox): boolean {
  if (!boitesSeTouchent(emprise(traits), f)) return false;
  const bord: [Pt, Pt][] = segmentsDe([f.min, pt(f.max.x, f.min.y), f.max, pt(f.min.x, f.max.y)], true);
  for (const t of traits) {
    const segs =
      t.kind === 'ligne'
        ? [[t.a, t.b] as [Pt, Pt]]
        : t.kind === 'polyligne'
          ? segmentsDe(t.points, t.fermee)
          : t.kind === 'hachure' || t.kind === 'remplissage'
            ? segmentsDe(t.contour, true)
            : t.kind === 'texte'
              ? segmentsDe(coinsDuTexte(t), true)
              : null;
    // Cercles et arcs : l'emprise suffit à cette échelle de précision.
    if (segs === null) return true;
    for (const [a, b] of segs) {
      if (dansLaBoite(a, f) || dansLaBoite(b, f)) return true;
      if (bord.some(([c, d]) => intersectionSegments(a, b, c, d) !== null)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Accrochage                                                          */
/* ------------------------------------------------------------------ */

export type ModeAccrochage = 'extremite' | 'milieu' | 'centre' | 'intersection' | 'quadrant' | 'insertion';

export interface PointAccroche {
  readonly p: Pt;
  readonly mode: ModeAccrochage;
}

/** Points remarquables d'une entité, ceux sur lesquels le pointeur s'accroche. */
export function pointsRemarquables(e: DrawEntity): PointAccroche[] {
  const milieu = (a: Pt, b: Pt): PointAccroche => ({ p: pt((a.x + b.x) / 2, (a.y + b.y) / 2), mode: 'milieu' });
  switch (e.kind) {
    case 'ligne':
      return [{ p: e.a, mode: 'extremite' }, { p: e.b, mode: 'extremite' }, milieu(e.a, e.b)];
    case 'polyligne':
      return [
        ...e.points.map((p) => ({ p, mode: 'extremite' as const })),
        ...segmentsDe(e.points, e.fermee).map(([a, b]) => milieu(a, b)),
      ];
    case 'cercle':
      return [
        { p: e.c, mode: 'centre' },
        ...[0, 1, 2, 3].map((k) => ({ p: pt(e.c.x + e.r * Math.cos((k * Math.PI) / 2), e.c.y + e.r * Math.sin((k * Math.PI) / 2)), mode: 'quadrant' as const })),
      ];
    case 'arc': {
      const sur = (a: number): Pt => pt(e.c.x + e.r * Math.cos(a), e.c.y + e.r * Math.sin(a));
      return [
        { p: e.c, mode: 'centre' },
        { p: sur(e.a0), mode: 'extremite' },
        { p: sur(e.a1), mode: 'extremite' },
        { p: sur((e.a0 + e.a1) / 2), mode: 'milieu' },
      ];
    }
    case 'texte':
      return [{ p: e.at, mode: 'insertion' }];
    case 'hachure':
    case 'remplissage':
      return e.contour.map((p) => ({ p, mode: 'extremite' as const }));
  }
}

export function intersectionSegments(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = pt(b.x - a.x, b.y - a.y);
  const s = pt(d.x - c.x, d.y - c.y);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return pt(a.x + t * r.x, a.y + t * r.y);
}

/** Segments droits d'une entité, pour les intersections. */
export function segmentsDeLEntite(e: DrawEntity): [Pt, Pt][] {
  if (e.kind === 'ligne') return [[e.a, e.b]];
  if (e.kind === 'polyligne') return segmentsDe(e.points, e.fermee);
  return [];
}

/**
 * Meilleur point d'accrochage près du pointeur, ou `null`.
 *
 * Priorité au plus proche ; à distance égale, extrémité et intersection passent
 * devant le milieu — c'est l'ordre dans lequel un dessinateur vise.
 */
export function accrocher(p: Pt, traits: readonly DrawEntity[], tolerance: number): PointAccroche | null {
  let meilleur: PointAccroche | null = null;
  let dMin = tolerance;
  const essayer = (q: PointAccroche): void => {
    const d = Math.hypot(q.p.x - p.x, q.p.y - p.y);
    if (d < dMin - 1e-9) {
      dMin = d;
      meilleur = q;
    }
  };
  const proches = traits.filter((t) => distanceA(p, t) <= tolerance * 3);
  for (const t of proches) for (const q of pointsRemarquables(t)) essayer(q);
  const segs = proches.flatMap(segmentsDeLEntite).filter(([a, b]) => distanceAuSegment(p, a, b) <= tolerance);
  for (let i = 0; i < segs.length && i < 60; i++) {
    for (let j = i + 1; j < segs.length && j < 60; j++) {
      const [a, b] = segs[i] as [Pt, Pt];
      const [c, d] = segs[j] as [Pt, Pt];
      const x = intersectionSegments(a, b, c, d);
      if (x) essayer({ p: x, mode: 'intersection' });
    }
  }
  return meilleur;
}

/** Contrainte orthogonale : le point est ramené à l'horizontale ou à la verticale de la base. */
export function ortho(base: Pt, p: Pt): Pt {
  return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? pt(p.x, base.y) : pt(base.x, p.y);
}
