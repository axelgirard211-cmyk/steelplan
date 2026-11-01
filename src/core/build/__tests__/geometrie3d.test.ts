import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { fibreAbscissa, memberFrame, type Member, type MemberFrame } from '../../geometry/member';
import { sectionOutline, type Pt2, type SectionOutline } from '../../geometry/section';
import { add, dot, scale, sub, type Vec3 } from '../../math/vec3';
import { DEFAULT_PROJECT } from '../../model/defaults';
import type { ProjectParams } from '../../model/project';
import { TEMPLATES } from '../../model/templates';
import { diametreNominal, listerBoulons } from '../bolts';
import { buildProject } from '../buildProject';
import { plateFrame } from '../connections/geom';
import type { Plate, StructuralModel } from '../types';

/**
 * GÉOMÉTRIE 3D — chaque boulon dans ses trous, chaque tôle hors du métal voisin.
 *
 * ⚠ Ces défauts ne se voyaient qu'à l'écran, et seulement au bon nœud : têtes de
 * boulons à demi noyées dans les semelles, platines de faîtage dans la traverse
 * d'en face, tiges d'ancrage sous le poteau, goussets de ferme dépassant dans les
 * échantignolles, tubes de poutre au vent plantés dans les diagonales. Les
 * longueurs, les masses et les calculs restaient justes ; la pièce, elle, ne se
 * montait pas.
 *
 * Les boulons sont contrôlés aux cotes où la 3D les dessine — tige au diamètre
 * nominal, tête et écrou d'entreplat 1,5 d —, sur tous les gabarits.
 */

/** Aucun gabarit n'a d'ouverture : un projet en porte trois, de chaque nature. */
const AVEC_OUVERTURES: ProjectParams = {
  ...DEFAULT_PROJECT,
  ouvertures: {
    ...DEFAULT_PROJECT.ouvertures,
    enabled: true,
    items: [
      { id: 'P1', face: 'long-pan-gauche', type: 'portail', position: 7000, largeur: 4000, hauteur: 4000, allege: 0 },
      { id: 'C1', face: 'long-pan-droit', type: 'chassis', position: 13000, largeur: 2000, hauteur: 1200, allege: 1200 },
      { id: 'D1', face: 'pignon-ouest', type: 'porte', position: 2000, largeur: 1000, hauteur: 2100, allege: 0 },
    ],
  },
};
const PROJETS = [
  ['défaut', DEFAULT_PROJECT] as const,
  ...TEMPLATES.map((t) => [t.id, t.build()] as const),
  ['ouvertures', AVEC_OUVERTURES] as const,
];

/*
 * ⚠ RAPIDITÉ. Les contrôles ci-dessous posent des dizaines de milliers de
 * points contre chaque pièce voisine. Recalculer à chaque point le repère de la
 * barre, son contour de section ou le repère de la tôle coûtait l'essentiel du
 * temps : tout ce qui ne dépend que de la pièce est calculé UNE fois. Le modèle
 * de chaque gabarit l'est aussi, à la demande, et partagé par ses trois tests.
 * Les points contrôlés et les tolérances sont inchangés.
 */
const modeles = new Map<string, StructuralModel>();
function modele(nom: string, p: ProjectParams): StructuralModel {
  let M = modeles.get(nom);
  if (!M) {
    M = buildProject(p);
    modeles.set(nom, M);
  }
  return M;
}
const cadres = new WeakMap<Member, MemberFrame>();
function cadre(m: Member): MemberFrame {
  let f = cadres.get(m);
  if (!f) {
    f = memberFrame(m);
    cadres.set(m, f);
  }
  return f;
}
const cadresDeTole = new WeakMap<Plate, ReturnType<typeof plateFrame>>();
function cadreDeTole(pl: Plate): ReturnType<typeof plateFrame> {
  let f = cadresDeTole.get(pl);
  if (!f) {
    f = plateFrame(pl);
    cadresDeTole.set(pl, f);
  }
  return f;
}
const contours = new Map<number, Map<string, SectionOutline>>();
function contour(profileId: string, n: number): SectionOutline {
  let parProfil = contours.get(n);
  if (!parProfil) {
    parProfil = new Map();
    contours.set(n, parProfil);
  }
  let c = parProfil.get(profileId);
  if (!c) {
    c = sectionOutline(getProfile(profileId), n);
    parProfil.set(profileId, c);
  }
  return c;
}
/**
 * Repère et contour fin d'une barre, tels que les lit `dansBarre`, avec les
 * abscisses extrêmes de ses deux coupes sur les sommets du contour. L'abscisse
 * de coupe étant affine sur la section, un point plus près de l'about que la
 * coupe la plus reculée, de TOL ou moins, ne peut entrer dans le métal : il est
 * écarté sans calcul, exactement comme le ferait le calcul complet.
 */
interface BarreLue {
  readonly f: MemberFrame;
  readonly sec: SectionOutline;
  readonly sMin: number;
  readonly sMax: number;
}
const barresLues = new WeakMap<Member, BarreLue>();
function barreLue(m: Member): BarreLue {
  let b = barresLues.get(m);
  if (!b) {
    const f = cadre(m);
    const sec = contour(m.profileId, 4);
    let sMin = Infinity;
    let sMax = -Infinity;
    for (const q of sec.outer) {
      const s0 = fibreAbscissa(f, m.start, m.cutStart, q);
      const s1 = fibreAbscissa(f, m.start, m.cutEnd, q);
      sMin = Math.min(sMin, s0, s1);
      sMax = Math.max(sMax, s0, s1);
    }
    b = { f, sec, sMin, sMax };
    barresLues.set(m, b);
  }
  return b;
}
/** Encadrement du contour extérieur : un point hors de lui est hors du polygone. */
const encadrements = new WeakMap<readonly Pt2[], { y0: number; y1: number; z0: number; z1: number }>();
function horsEncadrement(q: Pt2, poly: readonly Pt2[]): boolean {
  let e = encadrements.get(poly);
  if (!e) {
    e = {
      y0: Math.min(...poly.map((p) => p.y)),
      y1: Math.max(...poly.map((p) => p.y)),
      z0: Math.min(...poly.map((p) => p.z)),
      z1: Math.max(...poly.map((p) => p.z)),
    };
    encadrements.set(poly, e);
  }
  return q.y < e.y0 || q.y > e.y1 || q.z < e.z0 || q.z > e.z1;
}
/** Pénétration tolérée (mm) : en deçà, c'est un contact. */
const TOL = 1;

type Boite = { min: Vec3; max: Vec3 };

function boite(pts: readonly Vec3[], marge = 0): Boite {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    for (const k of ['x', 'y', 'z'] as const) {
      min[k] = Math.min(min[k], p[k] - marge);
      max[k] = Math.max(max[k], p[k] + marge);
    }
  }
  return { min, max };
}
const chevauche = (a: Boite, b: Boite): boolean =>
  (['x', 'y', 'z'] as const).every((k) => a.min[k] <= b.max[k] && b.min[k] <= a.max[k]);

function dansPoly(p: Pt2, poly: readonly Pt2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt2;
    const b = poly[j] as Pt2;
    if (a.z > p.z !== b.z > p.z && p.y < ((b.y - a.y) * (p.z - a.z)) / (b.z - a.z) + a.y) c = !c;
  }
  return c;
}
function distPoly(p: Pt2, poly: readonly Pt2[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt2;
    const b = poly[(i + 1) % poly.length] as Pt2;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l2 = dy * dy + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.y - a.y) * dy + (p.z - a.z) * dz) / l2)) : 0;
    m = Math.min(m, Math.hypot(p.y - (a.y + t * dy), p.z - (a.z + t * dz)));
  }
  return m;
}

/** Profondeur (mm) à laquelle un point entre dans le métal d'une barre, trous déduits ; 0 s'il n'y est pas. */
function dansBarre(m: Member, P: Vec3): number {
  const { f, sec, sMin, sMax } = barreLue(m);
  const dx = P.x - m.start.x;
  const dy = P.y - m.start.y;
  const dz = P.z - m.start.z;
  const s = dx * f.ax.x + dy * f.ax.y + dz * f.ax.z;
  if (s <= sMin + TOL || s >= sMax - TOL) return 0;
  const q = { y: dx * f.ay.x + dy * f.ay.y + dz * f.ay.z, z: dx * f.az.x + dy * f.az.y + dz * f.az.z };
  if (horsEncadrement(q, sec.outer) || !dansPoly(q, sec.outer) || sec.holes.some((h) => dansPoly(q, h))) return 0;
  const s0 = fibreAbscissa(f, m.start, m.cutStart, q);
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, q);
  const prof = Math.min(distPoly(q, sec.outer), s - Math.min(s0, s1), Math.max(s0, s1) - s);
  if (prof <= TOL) return 0;
  for (const h of m.holes) {
    const dt = h.through === 'y' ? q.z - h.at.z : q.y - h.at.y;
    if (Math.hypot(s - h.s, dt) <= h.d / 2 + 0.5) return 0;
  }
  return prof;
}
/** Même chose dans une tôle, oblongs compris. */
function dansTole(pl: Plate, P: Vec3): number {
  const { u, v, n } = cadreDeTole(pl);
  const d = sub(P, pl.origin);
  const q = { y: dot(d, u), z: dot(d, v) };
  const e = Math.abs(dot(d, n));
  if (e > pl.thickness / 2 - TOL || horsEncadrement(q, pl.outline) || !dansPoly(q, pl.outline)) return 0;
  const prof = Math.min(distPoly(q, pl.outline), pl.thickness / 2 - e);
  if (prof <= TOL) return 0;
  for (const h of pl.holes) {
    const lg = h.oblong ? (h.oblong.longueur - h.d) / 2 : 0;
    const dy = q.y - h.at.y;
    const dz = q.z - h.at.z;
    const [dl, dt] = h.oblong?.sens === 'y' ? [dy, dz] : h.oblong ? [dz, dy] : [dy, dz];
    if (Math.hypot(Math.max(0, Math.abs(dl) - lg), dt) <= h.d / 2 + 0.5) return 0;
  }
  return prof;
}

function coinsDeTole(pl: Plate): Vec3[] {
  const { u, v } = cadreDeTole(pl);
  return pl.outline.map((q) => add(pl.origin, add(scale(u, q.y), scale(v, q.z))));
}
function enveloppeDeBarre(m: Member): Boite {
  const f = cadre(m);
  const r = Math.max(...contour(m.profileId, 1).outer.map((q) => Math.hypot(q.y, q.z)));
  const s0 = fibreAbscissa(f, m.start, m.cutStart, { y: 0, z: 0 });
  const s1 = fibreAbscissa(f, m.start, m.cutEnd, { y: 0, z: 0 });
  return boite([add(m.start, scale(f.ax, s0)), add(m.start, scale(f.ax, s1))], r);
}

/** Points d'un boulon tel que la 3D le dessine : tige, et couronnes de tête et d'écrou. */
function pointsDuBoulon(b: ReturnType<typeof listerBoulons>[number]): { lieu: string; P: Vec3 }[] {
  const ax = b.axis;
  const perp = Math.abs(ax.z) < 0.9 ? { x: -ax.y, y: ax.x, z: 0 } : { x: 0, y: -ax.z, z: ax.y };
  const e1 = scale(perp, 1 / Math.hypot(perp.x, perp.y, perp.z));
  const e2 = { x: ax.y * e1.z - ax.z * e1.y, y: ax.z * e1.x - ax.x * e1.z, z: ax.x * e1.y - ax.y * e1.x };
  const dn = diametreNominal(b);
  const autour = (o: Vec3, r: number, a: number): Vec3 =>
    add(o, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a))));
  const out: { lieu: string; P: Vec3 }[] = [];
  for (let k = 0.05; k < 1; k += 0.1) {
    for (let i = 0; i < 4; i++) out.push({ lieu: 'tige', P: autour(add(b.at, scale(ax, b.grip * k)), 0.45 * dn, (i * Math.PI) / 2) });
  }
  const rh = ((0.75 * dn) / Math.cos(Math.PI / 6)) * 0.97;
  for (const [lieu, o] of [
    ['tête', add(b.at, scale(ax, -0.325 * dn))],
    ['écrou', add(b.at, scale(ax, b.grip + 0.4 * dn))],
  ] as const) {
    for (let i = 0; i < 12; i++) out.push({ lieu, P: autour(o, i % 2 === 0 ? rh : rh * Math.cos(Math.PI / 6), (i * Math.PI) / 6) });
  }
  return out;
}

function conflitsDeBoulons(M: StructuralModel): string[] {
  const barres = M.members.map((m) => ({ m, b: enveloppeDeBarre(m) }));
  const toles = M.plates.map((pl) => ({ pl, b: boite(coinsDeTole(pl), pl.thickness) }));
  const out: string[] = [];
  for (const b of listerBoulons(M.members, M.plates)) {
    const pts = pointsDuBoulon(b);
    const zone = boite(pts.map((x) => x.P));
    const serres = new Set(b.pieces);
    const voisins = [
      ...barres.filter((x) => chevauche(x.b, zone)).map((x) => ({ id: x.m.id, dans: (P: Vec3) => dansBarre(x.m, P) })),
      ...toles.filter((x) => chevauche(x.b, zone)).map((x) => ({ id: x.pl.id, dans: (P: Vec3) => dansTole(x.pl, P) })),
    ];
    for (const { lieu, P } of pts) {
      const v = voisins.find((x) => !(lieu === 'tige' && serres.has(x.id)) && x.dans(P) > 0);
      if (v) {
        out.push(`${b.usage} : ${lieu} dans ${v.id}`);
        break;
      }
    }
  }
  return out;
}

function conflitsDeToles(M: StructuralModel): string[] {
  const out: string[] = [];
  const barres = M.members.map((m) => ({ m, b: enveloppeDeBarre(m) }));
  const toles = M.plates.map((pl) => ({ pl, b: boite(coinsDeTole(pl), pl.thickness) }));
  for (const { pl, b } of toles) {
    const { u, v } = cadreDeTole(pl);
    const ys = pl.outline.map((q) => q.y);
    const zs = pl.outline.map((q) => q.z);
    const pts: Vec3[] = [];
    for (let y = Math.min(...ys) + 3; y < Math.max(...ys) - 2; y += 15) {
      for (let z = Math.min(...zs) + 3; z < Math.max(...zs) - 2; z += 15) {
        const q = { y, z };
        if (!dansPoly(q, pl.outline) || distPoly(q, pl.outline) < 3) continue;
        const ouvert = pl.holes.some(
          (h) => Math.hypot(q.y - h.at.y, q.z - h.at.z) < h.d / 2 + 2 + (h.oblong ? h.oblong.longueur / 2 : 0),
        );
        if (!ouvert) pts.push(add(pl.origin, add(scale(u, y), scale(v, z))));
      }
    }
    for (const x of barres) {
      // Le plat d'about est engagé dans la fente de son propre tube.
      if ((pl.kind === 'plat-tube' && pl.porteur === x.m.id) || !chevauche(x.b, b)) continue;
      if (pts.some((P) => dansBarre(x.m, P) > 0)) out.push(`${pl.id} (${pl.kind}) dans ${x.m.id} (${x.m.role})`);
    }
    for (const o of toles) {
      if (o.pl === pl || !chevauche(o.b, b)) continue;
      if (pts.some((P) => dansTole(o.pl, P) > 0)) out.push(`${pl.id} (${pl.kind}) dans ${o.pl.id} (${o.pl.kind})`);
    }
    for (const h of pl.holes) {
      if (!dansPoly(h.at, pl.outline) || distPoly(h.at, pl.outline) < h.d / 2) out.push(`trou hors de ${pl.id} (${pl.kind})`);
    }
  }
  return out;
}

/**
 * Barres dans barres : la surface de chaque barre, échantillonnée le long de son
 * axe, contre le métal des autres.
 *
 * ⚠ Le pas suit la longueur : 60 mm laissaient passer une échantignolle de
 * 120 mm noyée de 26 mm dans l'aile d'un arbalétrier — l'aile fait 12 mm.
 */
function conflitsDeBarres(M: StructuralModel): string[] {
  const out: string[] = [];
  const env = M.members.map((m) => ({ m, b: enveloppeDeBarre(m) }));
  for (const a of env) {
    const f = cadre(a.m);
    const sec = contour(a.m.profileId, 2);
    const pts: Vec3[] = [];
    for (const q of [...sec.outer, ...sec.holes.flat()]) {
      const s0 = fibreAbscissa(f, a.m.start, a.m.cutStart, q);
      const s1 = fibreAbscissa(f, a.m.start, a.m.cutEnd, q);
      const l = Math.abs(s1 - s0);
      const n = Math.max(4, Math.ceil(l / Math.min(40, Math.max(8, l / 40))));
      for (let k = 0; k <= n; k++) {
        const s = s0 + (s1 - s0) * (0.002 + (0.996 * k) / n);
        pts.push(add(add(a.m.start, scale(f.ax, s)), add(scale(f.ay, q.y), scale(f.az, q.z))));
      }
    }
    for (const b of env) {
      if (a === b || !chevauche(a.b, b.b)) continue;
      if (pts.some((P) => dansBarre(b.m, P) > 0)) out.push(`${a.m.id} (${a.m.role}) dans ${b.m.id} (${b.m.role})`);
    }
  }
  return out;
}

describe('géométrie 3D de tous les gabarits', () => {
  it('pose les trois ouvertures du projet d’essai, chevêtres attachés', () => {
    const M = modele('ouvertures', AVEC_OUVERTURES);
    expect(M.members.filter((m) => m.role === 'chevetre').length).toBeGreaterThanOrEqual(9);
    // Chaque montant a son pied, et au moins un plat d'attache.
    for (const mo of M.members.filter((m) => m.role === 'chevetre' && Math.abs(m.start.z - m.end.z) > 1)) {
      expect(M.plates.some((pl) => pl.kind === 'platine-pied' && pl.porteur === mo.id), mo.id).toBe(true);
      expect(M.plates.some((pl) => pl.kind === 'attache-lisse' && pl.porteur === mo.id), mo.id).toBe(true);
    }
  });
  for (const [nom, p] of PROJETS) {
    it(`${nom} : chaque boulon traverse ses trous, sans toucher d'autre pièce`, () => {
      const c = conflitsDeBoulons(modele(nom, p));
      expect(c.slice(0, 10), `${c.length} conflit(s)`).toEqual([]);
    });
    it(`${nom} : aucune tôle n'entre dans une barre ou dans une autre tôle`, () => {
      const c = conflitsDeToles(modele(nom, p));
      expect(c.slice(0, 10), `${c.length} conflit(s)`).toEqual([]);
    });
    it(`${nom} : aucune barre n'entre dans une autre`, () => {
      const c = conflitsDeBarres(modele(nom, p));
      expect(c.slice(0, 10), `${c.length} conflit(s)`).toEqual([]);
    });
  }
});
