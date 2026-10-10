import type { EntiteDessin } from './retouches';
import { pt, type DrawEntity, type Layer, type Pt } from './scene';

/**
 * OPÉRATIONS DE DAO — décaler, ajuster, prolonger, arc par trois points.
 *
 * Tout en millimètres papier, sans écran : l'éditeur n'en fait que l'appel.
 */

const EPS = 1e-9;
type Ligne = Extract<DrawEntity, { kind: 'ligne' }>;

const sous = (a: Pt, b: Pt): Pt => pt(a.x - b.x, a.y - b.y);
const croix = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const norme = (a: Pt): number => Math.hypot(a.x, a.y);

/** Côté d'un point par rapport à la droite (a, b) : +1 à gauche, −1 à droite. */
function cote(a: Pt, b: Pt, p: Pt): number {
  return Math.sign(croix(sous(b, a), sous(p, a))) || 1;
}

/** Droite (a, b) décalée de `d` du côté `s` (+1 à gauche). */
function decalerSegment(a: Pt, b: Pt, d: number, s: number): [Pt, Pt] {
  const l = norme(sous(b, a)) || 1;
  const nx = (-(b.y - a.y) / l) * d * s;
  const ny = ((b.x - a.x) / l) * d * s;
  return [pt(a.x + nx, a.y + ny), pt(b.x + nx, b.y + ny)];
}

/** Intersection des DROITES (a, b) et (c, d), ou null si parallèles. */
function intersectionDroites(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sous(b, a);
  const s = sous(d, c);
  const den = croix(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = croix(sous(c, a), s) / den;
  return pt(a.x + t * r.x, a.y + t * r.y);
}

/**
 * Copie parallèle d'une entité, à `d` mm papier du côté où se trouve `vers`.
 * Lignes, polylignes (angles raccordés), cercles et arcs ; `null` sinon.
 */
export function decaler(e: EntiteDessin, d: number, vers: Pt): EntiteDessin | null {
  if (d <= 0) return null;
  switch (e.kind) {
    case 'ligne': {
      const [a, b] = decalerSegment(e.a, e.b, d, cote(e.a, e.b, vers));
      return { ...e, a, b };
    }
    case 'polyligne': {
      const p = e.points;
      if (p.length < 2) return null;
      // Côté choisi d'après le segment le plus proche du point visé.
      let iProche = 0;
      let dMin = Infinity;
      for (let i = 0; i + 1 < p.length; i++) {
        const m = pt(((p[i] as Pt).x + (p[i + 1] as Pt).x) / 2, ((p[i] as Pt).y + (p[i + 1] as Pt).y) / 2);
        const dist = norme(sous(vers, m));
        if (dist < dMin) {
          dMin = dist;
          iProche = i;
        }
      }
      const s = cote(p[iProche] as Pt, p[iProche + 1] as Pt, vers);
      const n = p.length;
      const segs: [Pt, Pt][] = [];
      const nSeg = e.fermee ? n : n - 1;
      for (let i = 0; i < nSeg; i++) segs.push(decalerSegment(p[i] as Pt, p[(i + 1) % n] as Pt, d, s));
      const points: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const avant = segs[(i - 1 + nSeg) % nSeg] as [Pt, Pt];
        const apres = segs[i % nSeg] as [Pt, Pt];
        if (!e.fermee && i === 0) points.push(apres[0]);
        else if (!e.fermee && i === n - 1) points.push(avant[1]);
        else points.push(intersectionDroites(avant[0], avant[1], apres[0], apres[1]) ?? apres[0]);
      }
      return { ...e, points };
    }
    case 'cercle': {
      const dedans = norme(sous(vers, e.c)) < e.r;
      const r = dedans ? e.r - d : e.r + d;
      return r > EPS ? { ...e, r } : null;
    }
    case 'arc': {
      const dedans = norme(sous(vers, e.c)) < e.r;
      const r = dedans ? e.r - d : e.r + d;
      return r > EPS ? { ...e, r } : null;
    }
    default:
      return null;
  }
}

/** Arc passant par trois points, de `a` à `c` en passant par `b`. */
export function arcPar3Points(a: Pt, b: Pt, c: Pt, layer: Layer): EntiteDessin | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < EPS) return null; // points alignés
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const centre = pt((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d);
  const ang = (p: Pt): number => Math.atan2(p.y - centre.y, p.x - centre.x);
  const a0 = ang(a);
  // Sens de parcours : celui qui passe par b. Trigonométrique si a→b→c tourne à gauche.
  const direct = croix(sous(b, a), sous(c, b)) > 0;
  let balayage = ang(c) - a0;
  if (direct) while (balayage <= 0) balayage += 2 * Math.PI;
  else while (balayage >= 0) balayage -= 2 * Math.PI;
  return { kind: 'arc', c: centre, r: norme(sous(a, centre)), a0, a1: a0 + balayage, layer };
}

/* ------------------------------------------------------------------ */
/* Intersections d'une droite avec les autres traits                   */
/* ------------------------------------------------------------------ */

/**
 * Paramètres t (le long de a→b, 0 en a, 1 en b, sur la DROITE entière) où elle
 * coupe les traits donnés : segments de lignes et de polylignes, cercles, arcs.
 */
export function coupuresDeLaDroite(a: Pt, b: Pt, traits: readonly DrawEntity[]): number[] {
  const r = sous(b, a);
  const out: number[] = [];
  const segment = (c: Pt, d: Pt): void => {
    const s = sous(d, c);
    const den = croix(r, s);
    if (Math.abs(den) < EPS) return;
    const t = croix(sous(c, a), s) / den;
    const u = croix(sous(c, a), r) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) out.push(t);
  };
  const cercle = (c: Pt, rayon: number, arc?: { a0: number; a1: number }): void => {
    // |a + t r − c|² = rayon²
    const f = sous(a, c);
    const A = r.x * r.x + r.y * r.y;
    const B = 2 * (f.x * r.x + f.y * r.y);
    const C = f.x * f.x + f.y * f.y - rayon * rayon;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < EPS) return;
    for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
      if (arc) {
        const p = pt(a.x + t * r.x - c.x, a.y + t * r.y - c.y);
        let ang = Math.atan2(p.y, p.x);
        const debut = Math.min(arc.a0, arc.a1);
        while (ang < debut) ang += 2 * Math.PI;
        while (ang >= debut + 2 * Math.PI) ang -= 2 * Math.PI;
        if (ang > Math.max(arc.a0, arc.a1) + 1e-9) continue;
      }
      out.push(t);
    }
  };
  for (const e of traits) {
    if (e.kind === 'ligne') segment(e.a, e.b);
    else if (e.kind === 'polyligne') {
      for (let i = 0; i + 1 < e.points.length; i++) segment(e.points[i] as Pt, e.points[i + 1] as Pt);
      if (e.fermee && e.points.length > 2) segment(e.points[e.points.length - 1] as Pt, e.points[0] as Pt);
    } else if (e.kind === 'cercle') cercle(e.c, e.r);
    else if (e.kind === 'arc') cercle(e.c, e.r, { a0: e.a0, a1: e.a1 });
  }
  return out;
}

/** Paramètre du point le plus proche de p sur la droite a→b. */
function parametre(a: Pt, b: Pt, p: Pt): number {
  const r = sous(b, a);
  const l2 = r.x * r.x + r.y * r.y;
  return l2 < EPS ? 0 : ((p.x - a.x) * r.x + (p.y - a.y) * r.y) / l2;
}

/**
 * AJUSTER : retire d'une ligne le tronçon cliqué, entre les deux traits qui
 * l'encadrent. Rend les morceaux qui restent (un, deux ou aucun), ou `null` si
 * aucun trait ne la coupe — rien à ajuster.
 */
export function ajuster(l: Ligne, clic: Pt, autres: readonly DrawEntity[]): Ligne[] | null {
  const ts = coupuresDeLaDroite(l.a, l.b, autres).filter((t) => t > 1e-6 && t < 1 - 1e-6);
  if (ts.length === 0) return null;
  const tc = Math.min(1, Math.max(0, parametre(l.a, l.b, clic)));
  const avant = Math.max(0, ...ts.filter((t) => t < tc));
  const apres = Math.min(1, ...ts.filter((t) => t > tc));
  const point = (t: number): Pt => pt(l.a.x + t * (l.b.x - l.a.x), l.a.y + t * (l.b.y - l.a.y));
  const morceaux: Ligne[] = [];
  if (avant > 1e-6) morceaux.push({ ...l, a: l.a, b: point(avant) });
  if (apres < 1 - 1e-6) morceaux.push({ ...l, a: point(apres), b: l.b });
  return morceaux;
}

/**
 * PROLONGER : allonge la ligne, par le bout le plus proche du clic, jusqu'au
 * premier trait qu'elle rencontre ; `null` si elle n'en rencontre aucun.
 */
export function prolonger(l: Ligne, clic: Pt, autres: readonly DrawEntity[]): Ligne | null {
  const versB = parametre(l.a, l.b, clic) >= 0.5;
  const ts = coupuresDeLaDroite(l.a, l.b, autres);
  const point = (t: number): Pt => pt(l.a.x + t * (l.b.x - l.a.x), l.a.y + t * (l.b.y - l.a.y));
  if (versB) {
    const t = Math.min(...ts.filter((x) => x > 1 + 1e-6));
    return Number.isFinite(t) ? { ...l, b: point(t) } : null;
  }
  const t = Math.max(...ts.filter((x) => x < -1e-6));
  return Number.isFinite(t) ? { ...l, a: point(t) } : null;
}

/* ------------------------------------------------------------------ */
/* Poignées                                                            */
/* ------------------------------------------------------------------ */

export interface Poignee {
  readonly p: Pt;
  /** L'entité, la poignée amenée en `q`. */
  readonly vers: (q: Pt) => EntiteDessin;
}

/**
 * Poignées d'une entité, comme en DAO : bouts et milieu d'une ligne (le
 * milieu la déplace), sommets d'une polyligne, centre et quadrants d'un cercle
 * (le centre le déplace, un quadrant change son rayon), point d'insertion d'un
 * texte, origines et ligne d'une cote.
 */
export function poigneesDe(e: EntiteDessin): Poignee[] {
  const decale = (p: Pt, q: Pt, o: Pt): Pt => pt(o.x + q.x - p.x, o.y + q.y - p.y);
  switch (e.kind) {
    case 'ligne': {
      const m = pt((e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2);
      return [
        { p: e.a, vers: (q) => ({ ...e, a: q }) },
        { p: e.b, vers: (q) => ({ ...e, b: q }) },
        { p: m, vers: (q) => ({ ...e, a: decale(m, q, e.a), b: decale(m, q, e.b) }) },
      ];
    }
    case 'polyligne':
    case 'hachure':
    case 'remplissage': {
      const l = e.kind === 'polyligne' ? e.points : e.contour;
      return l.map((p, i) => ({
        p,
        vers: (q: Pt): EntiteDessin => {
          const n = l.map((x, j) => (j === i ? q : x));
          return e.kind === 'polyligne' ? { ...e, points: n } : { ...e, contour: n };
        },
      }));
    }
    case 'cercle':
      return [
        { p: e.c, vers: (q) => ({ ...e, c: q }) },
        ...[0, 1, 2, 3].map((k) => ({
          p: pt(e.c.x + e.r * Math.cos((k * Math.PI) / 2), e.c.y + e.r * Math.sin((k * Math.PI) / 2)),
          vers: (q: Pt): EntiteDessin => ({ ...e, r: Math.max(0.01, norme(sous(q, e.c))) }),
        })),
      ];
    case 'arc':
      return [{ p: e.c, vers: (q) => ({ ...e, c: q }) }];
    case 'texte':
      return [{ p: e.at, vers: (q) => ({ ...e, at: q }) }];
    case 'cote': {
      const l = norme(sous(e.b, e.a)) || 1;
      const n = pt(-(e.b.y - e.a.y) / l, (e.b.x - e.a.x) / l);
      const m = pt((e.a.x + e.b.x) / 2 + n.x * e.decalage, (e.a.y + e.b.y) / 2 + n.y * e.decalage);
      return [
        { p: e.a, vers: (q) => ({ ...e, a: q }) },
        { p: e.b, vers: (q) => ({ ...e, b: q }) },
        { p: m, vers: (q) => ({ ...e, decalage: (q.x - e.a.x) * n.x + (q.y - e.a.y) * n.y }) },
      ];
    }
  }
}
