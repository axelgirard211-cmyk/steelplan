import type { Member } from '../../geometry/member';
import type { Pt2 } from '../../geometry/section';
import { cross, normalize, scale, sub, type Vec3 } from '../../math/vec3';
import type { Plate } from '../types';

/**
 * Utilitaires géométriques des assemblages.
 *
 * Ces fonctions mesurent des barres et des points sur leur axe. Elles ignorent
 * tout du détail d'assemblage qu'elles servent à construire : c'est ce qui
 * permet aux générateurs de platines, de goussets et d'attaches de partager
 * exactement le même calcul, donc de ne pas diverger.
 */

/** Contour rectangulaire centré sur l'origine du repère local d'une tôle. */
export function rectangle(largeur: number, hauteur: number): Pt2[] {
  const y = largeur / 2;
  const z = hauteur / 2;
  return [
    { y, z: -z },
    { y, z },
    { y: -y, z },
    { y: -y, z: -z },
  ];
}

export function proche(a: Vec3, b: Vec3, tol = 1): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= tol;
}

/** Deux barres poursuivent-elles la même direction (à 0,5° près) ? */
export function colineaires(a: Member, b: Member): boolean {
  const u = normalize(sub(a.end, a.start));
  const v = normalize(sub(b.end, b.start));
  return u.x * v.x + u.y * v.y + u.z * v.z > 0.99996;
}

/** Le point `q` est-il sur l'axe de la barre `m`, abouts compris, à `tol` près ? */
export function surLAxe(q: Vec3, m: Member, tol: number): boolean {
  const d = sub(m.end, m.start);
  const l2 = d.x * d.x + d.y * d.y + d.z * d.z;
  if (l2 < 1e-12) return proche(q, m.start, tol);
  const w = sub(q, m.start);
  const t = Math.max(0, Math.min(1, (w.x * d.x + w.y * d.y + w.z * d.z) / l2));
  const projete = { x: m.start.x + d.x * t, y: m.start.y + d.y * t, z: m.start.z + d.z * t };
  return proche(q, projete, tol);
}

/** Point de l'axe d'une barre à l'abscisse `s` depuis son about d'origine. */
export function pointSurLAxe(m: Member, s: number): Vec3 {
  const l = longueurAxe(m);
  if (l < 1e-9) return m.start;
  const t = s / l;
  return {
    x: m.start.x + (m.end.x - m.start.x) * t,
    y: m.start.y + (m.end.y - m.start.y) * t,
    z: m.start.z + (m.end.z - m.start.z) * t,
  };
}

/** Abscisse de la projection d'un point sur l'axe d'une barre. */
export function abscisseSurLAxe(m: Member, q: Vec3): number {
  const d = sub(m.end, m.start);
  const l2 = d.x * d.x + d.y * d.y + d.z * d.z;
  if (l2 < 1e-12) return 0;
  const w = sub(q, m.start);
  const t = (w.x * d.x + w.y * d.y + w.z * d.z) / l2;
  return Math.max(0, Math.min(1, t)) * Math.sqrt(l2);
}

/** Distance d'un point au segment d'une barre. */
export function distanceAuSegment(q: Vec3, m: Member): number {
  const s = abscisseSurLAxe(m, q);
  const p = pointSurLAxe(m, s);
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
}

export function longueurAxe(m: Member): number {
  return Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
}

/** Repère orthonormé d'une tôle, pour le maillage 3D et les plans. */
export function plateFrame(pl: Plate): { u: Vec3; v: Vec3; n: Vec3 } {
  const u = normalize(pl.u);
  const v = normalize(sub(pl.v, scale(u, pl.v.x * u.x + pl.v.y * u.y + pl.v.z * u.z)));
  return { u, v, n: cross(u, v) };
}

/** Enveloppe convexe (monotone chain), sens trigonométrique. */
export function enveloppe(points: readonly Pt2[]): Pt2[] {
  const pts = [...points].sort((a, b) => a.y - b.y || a.z - b.z);
  const croix = (o: Pt2, a: Pt2, b: Pt2): number => (a.y - o.y) * (b.z - o.z) - (a.z - o.z) * (b.y - o.y);
  const bas: Pt2[] = [];
  for (const q of pts) {
    while (bas.length >= 2 && croix(bas[bas.length - 2] as Pt2, bas[bas.length - 1] as Pt2, q) <= 0) bas.pop();
    bas.push(q);
  }
  const haut: Pt2[] = [];
  for (const q of [...pts].reverse()) {
    while (haut.length >= 2 && croix(haut[haut.length - 2] as Pt2, haut[haut.length - 1] as Pt2, q) <= 0) haut.pop();
    haut.push(q);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}

/**
 * Contour d'une tôle découpée autour de ses trous : l'enveloppe convexe des
 * octogones de pince qui les entourent — la forme que le traceur dessine
 * autour d'une ligne de boulons.
 */
export function contourAutourDesTrous(trous: readonly Pt2[], pince: number, autres: readonly Pt2[] = []): Pt2[] {
  const r = pince / Math.cos(Math.PI / 8);
  return enveloppe([
    ...trous.flatMap((h) =>
      Array.from({ length: 8 }, (_, i) => ({
        y: h.y + r * Math.cos(((i + 0.5) * Math.PI) / 4),
        z: h.z + r * Math.sin(((i + 0.5) * Math.PI) / 4),
      })),
    ),
    ...autres,
  ]);
}

/** Polygone convexe rogné au demi-plan n·q ≤ c. */
export function couperDemiPlan(poly: readonly Pt2[], n: Pt2, c: number): Pt2[] {
  const dedans = (q: Pt2): boolean => q.y * n.y + q.z * n.z <= c + 1e-9;
  const out: Pt2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt2;
    const b = poly[(i + 1) % poly.length] as Pt2;
    if (dedans(a)) out.push(a);
    if (dedans(a) !== dedans(b)) {
      const da = a.y * n.y + a.z * n.z - c;
      const db = b.y * n.y + b.z * n.z - c;
      const t = da / (da - db);
      out.push({ y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
    }
  }
  return out;
}
