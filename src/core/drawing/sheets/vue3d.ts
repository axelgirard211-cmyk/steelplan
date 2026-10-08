import { getProfile } from '../../catalog/index';
import { plateFrame } from '../../build/connections/geom';
import { contourJarret } from '../../build/jarret';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { add, scale, type Vec3 } from '../../math/vec3';
import { dansLaBarre } from '../barre/vue';
import { pt, type Bbox, type DrawScene, type Pt } from '../scene';
import type { ElementFabrication } from './element';

/**
 * VUE 3D DE L'ÉLÉMENT — pour voir, d'un coup d'œil, à quoi ressemble la pièce
 * finie : de quel côté sont les goussets, où pend le jarret, quelle extrémité
 * reçoit la platine.
 *
 * ⚠ Elle est INDICATIVE, et le dit : on n'y mesure rien. Les vues cotées restent
 * le document ; celle-ci sert à ne pas les lire à l'envers.
 *
 * Perspective axonométrique, éclairage en niveaux de gris selon l'orientation des
 * faces, et tracé du fond vers l'avant — la face la plus proche masque les
 * autres, comme sur un croquis. Les longs pans sont découpés en tronçons pour
 * que l'ordre de tracé reste juste le long d'une barre de dix mètres.
 */

type P3 = { s: number; y: number; z: number };

interface Face {
  readonly pts: readonly P3[];
  /** Arêtes à tracer : indices de sommets consécutifs, ou tout le contour. */
  readonly aretes: 'contour' | readonly [number, number][];
  readonly centre: P3;
  /** Normale SORTANTE du solide. */
  readonly n: P3;
}

/** Direction de vision dans le repère de la barre : un peu depuis l'origine, de face, d'en haut. */
const D = normer({ s: 0.42, y: 1, z: -0.62 });
/** Lumière, venue d'en haut et de face. */
const L = normer({ s: -0.3, y: -0.5, z: 0.8 });
const TRONCONS = 14;

export function dessinerVue3D(
  s: DrawScene,
  e: ElementFabrication,
  zone: Bbox,
  /**
   * Abscisse raccourcie : celle de la vue de face interrompue. Un poteau de six
   * mètres dans une case de onze centimètres n'est qu'un trait ; resserré comme
   * sur la vue de face, ses abouts et ses goussets se reconnaissent.
   */
  raccourci: (s: number) => number = (x) => x,
): void {
  const m = e.membre;
  const f = memberFrame(m);
  const faces: Face[] = [];
  const versBarre = (q: Vec3): P3 => {
    const p = dansLaBarre(f, m.start, q);
    return { ...p, s: raccourci(p.s) };
  };

  prisme(faces, m, versBarre, false);
  // Une pièce symétrisée a un repère indirect : son contour s'y parcourt à l'envers.
  for (const x of e.pieces) prisme(faces, x, versBarre, x.mirrored !== m.mirrored);
  for (const pl of e.toles) {
    const { n } = plateFrame(pl);
    const cote = (k: number): P3[] =>
      pl.outline.map((q) => versBarre(add(add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z))), scale(n, (k * pl.thickness) / 2))));
    plaque(faces, cote(-1), cote(1));
  }
  for (const j of e.jarrets) {
    const c = contourJarret(j);
    const b = getProfile(j.profileId).b / 2;
    const cote = (k: number): P3[] => [c.haut, c.bas, c.pointe].map((q) => versBarre(add(q, scale(f.ay, k * b))));
    plaque(faces, cote(-1), cote(1));
  }

  // Repère papier : droite = D × z, haut = droite × D.
  const R = normer({ s: D.y, y: -D.s, z: 0 });
  const U = croix(R, D);
  const ecran = (q: P3): { x: number; y: number } => ({ x: scal(q, R), y: scal(q, U) });
  const tous = faces.flatMap((x) => x.pts.map(ecran));
  const xMin = Math.min(...tous.map((q) => q.x));
  const xMax = Math.max(...tous.map((q) => q.x));
  const yMin = Math.min(...tous.map((q) => q.y));
  const yMax = Math.max(...tous.map((q) => q.y));
  const k = Math.min((zone.max.x - zone.min.x - 4) / Math.max(1, xMax - xMin), (zone.max.y - zone.min.y - 9) / Math.max(1, yMax - yMin));
  const ox = (zone.min.x + zone.max.x) / 2 - ((xMin + xMax) / 2) * k;
  const oy = zone.min.y + 2 + (zone.max.y - zone.min.y - 9) / 2 - ((yMin + yMax) / 2) * k;
  const P = (q: P3): Pt => {
    const p = ecran(q);
    return pt(ox + p.x * k, oy + p.y * k);
  };

  // Du plus loin au plus proche ; les faces tournées vers l'arrière ne se voient pas.
  const visibles = faces.filter((x) => scal(x.n, D) < 0).sort((a, b) => scal(b.centre, D) - scal(a.centre, D));
  for (const x of visibles) {
    const n = x.n;
    const pts = x.pts.map(P);
    const eclairage = Math.max(0, -scal(n, L));
    s.remplissage(pts, [], 0.62 + 0.36 * eclairage, 'contour-fin');
    if (x.aretes === 'contour') s.polyligne(pts, true, 'contour-fin');
    else for (const [i, j] of x.aretes) s.ligne(pts[i] as Pt, pts[j] as Pt, 'contour-fin');
  }
  s.texte(pt((zone.min.x + zone.max.x) / 2, zone.max.y - 3), 'VUE 3D — raccourcie, non cotée', {
    hauteur: 2.2,
    gras: true,
    ancrage: 'centre',
  });
}

/** Barre extrudée entre ses deux coupes, ses longs pans découpés en tronçons. */
function prisme(faces: Face[], x: Member, versBarre: (q: Vec3) => P3, inverse: boolean): void {
  const fx = memberFrame(x);
  const oriente = orienter(sectionOutline(getProfile(x.profileId), 1).outer);
  const contour = inverse ? oriente.reverse() : oriente;
  const en = (q: { y: number; z: number }, sAbs: number): P3 =>
    versBarre(add(add(x.start, scale(fx.ax, sAbs)), add(scale(fx.ay, q.y), scale(fx.az, q.z))));
  const s0 = contour.map((q) => fibreAbscissa(fx, x.start, x.cutStart, q));
  const s1 = contour.map((q) => fibreAbscissa(fx, x.start, x.cutEnd, q));
  const capot = (ss: number[], inverse: boolean): void => {
    const pts = contour.map((q, i) => en(q, ss[i] as number));
    ajouter(faces, inverse ? [...pts].reverse() : pts, 'contour');
  };
  capot(s0, true);
  capot(s1, false);
  // Arêtes VIVES seulement : un tube rond, découpé en facettes, se couvrait de rayures.
  const vive = contour.map((q, i) => {
    const a = contour[(i - 1 + contour.length) % contour.length] as { y: number; z: number };
    const b = contour[(i + 1) % contour.length] as { y: number; z: number };
    const u = { y: q.y - a.y, z: q.z - a.z };
    const v = { y: b.y - q.y, z: b.z - q.z };
    const c = (u.y * v.y + u.z * v.z) / ((Math.hypot(u.y, u.z) || 1) * (Math.hypot(v.y, v.z) || 1));
    return c < Math.cos((25 * Math.PI) / 180);
  });
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i] as { y: number; z: number };
    const b = contour[(i + 1) % contour.length] as { y: number; z: number };
    const j = (i + 1) % contour.length;
    for (let t = 0; t < TRONCONS; t++) {
      // Tronçons légèrement chevauchants : bord à bord, l'anticrénelage laissait
      // un liseré clair à chaque couture.
      const t0 = Math.max(0, t - 0.04);
      const t1 = Math.min(TRONCONS, t + 1.04);
      const sa0 = (s0[i] as number) + (((s1[i] as number) - (s0[i] as number)) * t0) / TRONCONS;
      const sa1 = (s0[i] as number) + (((s1[i] as number) - (s0[i] as number)) * t1) / TRONCONS;
      const sb0 = (s0[j] as number) + (((s1[j] as number) - (s0[j] as number)) * t0) / TRONCONS;
      const sb1 = (s0[j] as number) + (((s1[j] as number) - (s0[j] as number)) * t1) / TRONCONS;
      // Sens a0 → b0 → b1 → a1 : le contour tourne dans le sens trigonométrique
      // autour de l'axe, la normale sort donc du profil — y compris sous une
      // semelle, face rentrante qu'un test au centre du solide retournerait.
      // Seules les arêtes longitudinales se tracent : pas les coutures des tronçons.
      const aretes: [number, number][] = [];
      if (vive[i]) aretes.push([0, 3]);
      if (vive[j]) aretes.push([1, 2]);
      ajouter(faces, [en(a, sa0), en(b, sb0), en(b, sb1), en(a, sa1)], aretes);
    }
  }
}

/**
 * Plaque d'épaisseur : deux faces et leurs chants. Solide convexe : la normale
 * sortante est celle qui s'éloigne de son centre.
 */
function plaque(faces: Face[], dessous: P3[], dessus: P3[]): void {
  const c = centreDe([...dessous, ...dessus]);
  const sortante = (pts: P3[]): void => {
    const n = normale(pts);
    const q = centreDe(pts);
    const versDehors = scal(n, { s: q.s - c.s, y: q.y - c.y, z: q.z - c.z }) >= 0;
    faces.push({ pts, aretes: 'contour', centre: q, n: versDehors ? n : { s: -n.s, y: -n.y, z: -n.z } });
  };
  sortante(dessous);
  sortante(dessus);
  for (let i = 0; i < dessous.length; i++) {
    const j = (i + 1) % dessous.length;
    sortante([dessous[i] as P3, dessous[j] as P3, dessus[j] as P3, dessus[i] as P3]);
  }
}

/** Face de profil : sa normale suit le sens de parcours de ses sommets. */
function ajouter(faces: Face[], pts: readonly P3[], aretes: Face['aretes']): void {
  faces.push({ pts, aretes, centre: centreDe(pts), n: normale(pts) });
}

function centreDe(pts: readonly P3[]): P3 {
  const n = pts.length || 1;
  return {
    s: pts.reduce((t, q) => t + q.s, 0) / n,
    y: pts.reduce((t, q) => t + q.y, 0) / n,
    z: pts.reduce((t, q) => t + q.z, 0) / n,
  };
}

/** Normale d'une face par la méthode de Newell, dans le sens de parcours des sommets. */
function normale(pts: readonly P3[]): P3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P3;
    const b = pts[(i + 1) % pts.length] as P3;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.s + b.s);
    nz += (a.s - b.s) * (a.y + b.y);
  }
  return normer({ s: nx, y: ny, z: nz });
}

/** Contour de section parcouru dans le sens trigonométrique. */
function orienter(c: readonly { y: number; z: number }[]): { y: number; z: number }[] {
  let aire = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i] as { y: number; z: number };
    const b = c[(i + 1) % c.length] as { y: number; z: number };
    aire += a.y * b.z - b.y * a.z;
  }
  return aire >= 0 ? [...c] : [...c].reverse();
}

function normer(v: P3): P3 {
  const l = Math.hypot(v.s, v.y, v.z) || 1;
  return { s: v.s / l, y: v.y / l, z: v.z / l };
}

function scal(a: P3, b: P3): number {
  return a.s * b.s + a.y * b.y + a.z * b.z;
}

function croix(a: P3, b: P3): P3 {
  return { s: a.y * b.z - a.z * b.y, y: a.z * b.s - a.s * b.z, z: a.s * b.y - a.y * b.s };
}
