import { deg2rad } from '../math/tolerance';
import { pt, type Pt } from './scene';

/**
 * Développement des hachures en SEGMENTS.
 *
 * Un motif de hachure peut être délégué au moteur de rendu — SVG sait le faire
 * nativement — mais alors chaque moteur hachurerait à sa façon, et le PDF
 * imprimé ne montrerait pas tout à fait le dessin affiché. On calcule donc les
 * traits UNE fois, ici, et les trois moteurs reçoivent la même géométrie.
 *
 * Le principe est celui du balayage : on incline le repère pour ramener les
 * hachures à l'horizontale, on coupe chaque ligne de balayage par le contour et
 * ses vides selon la règle pair-impair, puis on remet le tout d'aplomb.
 */
export interface Segment {
  readonly a: Pt;
  readonly b: Pt;
}

export function hatchLines(
  contour: readonly Pt[],
  trous: readonly (readonly Pt[])[],
  pas: number,
  angleDeg: number,
): Segment[] {
  if (contour.length < 3 || pas <= 0) return [];

  const a = deg2rad(angleDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Rotation de −angle : les hachures deviennent horizontales.
  const tourner = (p: Pt): Pt => pt(p.x * cos + p.y * sin, -p.x * sin + p.y * cos);
  const detourner = (p: Pt): Pt => pt(p.x * cos - p.y * sin, p.x * sin + p.y * cos);

  const anneaux = [contour, ...trous].map((r) => r.map(tourner));
  const tous = anneaux.flat();
  const yMin = Math.min(...tous.map((p) => p.y));
  const yMax = Math.max(...tous.map((p) => p.y));

  // Les lignes de balayage sont calées sur une grille absolue : deux zones
  // hachurées voisines restent alignées, ce qui se voit tout de suite à l'œil.
  const k0 = Math.ceil(yMin / pas);
  const k1 = Math.floor(yMax / pas);
  if (k1 < k0) return [];

  const out: Segment[] = [];
  for (let k = k0; k <= k1; k++) {
    const y = k * pas;
    const croisements: number[] = [];

    for (const anneau of anneaux) {
      for (let i = 0; i < anneau.length; i++) {
        const p0 = anneau[i] as Pt;
        const p1 = anneau[(i + 1) % anneau.length] as Pt;
        // Règle semi-ouverte : un sommet posé sur la ligne n'est compté qu'une
        // fois, sans quoi les hachures « fuiraient » hors du contour.
        const monte = p0.y <= y && p1.y > y;
        const descend = p1.y <= y && p0.y > y;
        if (!monte && !descend) continue;
        croisements.push(p0.x + ((y - p0.y) / (p1.y - p0.y)) * (p1.x - p0.x));
      }
    }

    croisements.sort((u, v) => u - v);
    for (let i = 0; i + 1 < croisements.length; i += 2) {
      const x0 = croisements[i] as number;
      const x1 = croisements[i + 1] as number;
      if (x1 - x0 < 1e-9) continue;
      out.push({ a: detourner(pt(x0, y)), b: detourner(pt(x1, y)) });
    }
  }
  return out;
}

/**
 * Aplatissement d'un arc en polyligne.
 *
 * Ni le PDF ni le DXF R12 ne reçoivent d'arc de la même façon que le SVG : on
 * les ramène tous à des segments, avec une flèche de corde assez fine pour être
 * invisible à l'impression (0,05 mm papier).
 */
export function flattenArc(
  c: Pt,
  r: number,
  a0: number,
  a1: number,
  flecheMax = 0.05,
): Pt[] {
  const balayage = Math.abs(a1 - a0);
  if (r <= 0 || balayage < 1e-9) return [];
  // Flèche f = r(1 − cos(Δ/2)) ⇒ Δ = 2·acos(1 − f/r)
  const dMax = r > flecheMax ? 2 * Math.acos(1 - flecheMax / r) : Math.PI / 4;
  const n = Math.max(2, Math.ceil(balayage / dMax));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return pt(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  });
}

/** Cercle complet ramené à une polyligne fermée. */
export function flattenCircle(c: Pt, r: number, flecheMax = 0.05): Pt[] {
  const pts = flattenArc(c, r, 0, 2 * Math.PI, flecheMax);
  pts.pop(); // le dernier point rejoint le premier
  return pts;
}
