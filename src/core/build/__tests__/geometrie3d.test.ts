import { describe, expect, it } from 'vitest';
import { getProfile } from '../../catalog/index';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { sectionOutline, type Pt2, type SectionOutline } from '../../geometry/section';
import { add, dot, scale, sub, type Vec3 } from '../../math/vec3';
import { DEFAULT_PROJECT } from '../../model/defaults';
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

const PROJETS = [['défaut', DEFAULT_PROJECT] as const, ...TEMPLATES.map((t) => [t.id, t.build()] as const)];
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

const sections = new Map<string, SectionOutline>();
/** Profondeur (mm) à laquelle un point entre dans le métal d'une barre, trous déduits ; 0 s'il n'y est pas. */
function dansBarre(m: Member, P: Vec3): number {
  const f = memberFrame(m);
  const d = sub(P, m.start);
  const q = { y: dot(d, f.ay), z: dot(d, f.az) };
  const s = dot(d, f.ax);
  const sec = sections.get(m.profileId) ?? sectionOutline(getProfile(m.profileId), 4);
  sections.set(m.profileId, sec);
  if (!dansPoly(q, sec.outer) || sec.holes.some((h) => dansPoly(q, h))) return 0;
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
  const { u, v, n } = plateFrame(pl);
  const d = sub(P, pl.origin);
  const q = { y: dot(d, u), z: dot(d, v) };
  const e = Math.abs(dot(d, n));
  if (e > pl.thickness / 2 - TOL || !dansPoly(q, pl.outline)) return 0;
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
  const { u, v } = plateFrame(pl);
  return pl.outline.map((q) => add(pl.origin, add(scale(u, q.y), scale(v, q.z))));
}
function enveloppeDeBarre(m: Member): Boite {
  const f = memberFrame(m);
  const r = Math.max(...sectionOutline(getProfile(m.profileId), 1).outer.map((q) => Math.hypot(q.y, q.z)));
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
    const { u, v } = plateFrame(pl);
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

describe('géométrie 3D de tous les gabarits', () => {
  for (const [nom, p] of PROJETS) {
    const M = buildProject(p);
    it(`${nom} : chaque boulon traverse ses trous, sans toucher d'autre pièce`, () => {
      const c = conflitsDeBoulons(M);
      expect(c.slice(0, 10), `${c.length} conflit(s)`).toEqual([]);
    });
    it(`${nom} : aucune tôle n'entre dans une barre ou dans une autre tôle`, () => {
      const c = conflitsDeToles(M);
      expect(c.slice(0, 10), `${c.length} conflit(s)`).toEqual([]);
    });
  }
});
