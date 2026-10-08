import { getProfile } from '../../catalog/index';
import { hole, type Hole } from '../../geometry/holes';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { add, cross, dot, normalize, scale, sub, v3, type Vec3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import { courseDeTete } from '../secondaire/facades';
import type { Plate } from '../types';

/**
 * ATTACHE DE TÊTE DE POTELET — un gousset soudé sous ce qui coiffe le potelet,
 * boulonné sur son âme au travers de trous OBLONGS verticaux.
 *
 * ⚠ La tête des potelets ne tenait à rien : rien ne ramenait à la toiture le vent
 * que le pignon leur donne, alors que le calcul les suppose appuyés en tête.
 *
 * Le potelet transmet le vent, horizontal ; il ne doit pas porter la traverse,
 * qui fléchit. Les oblongs sont percés dans le gousset, dans le sens de cette
 * flèche : le boulon y coulisse de ±25 mm, et le potelet, arrêté 30 mm sous la
 * traverse, ne la rencontre pas.
 *
 * Sous le faîtage, la traverse n'existe plus — ses deux tronçons s'arrêtent sur
 * leurs platines. Le gousset se soude alors sous la platine de faîtage dont
 * l'épaisseur le contient.
 */

/** Distance du rang de boulons de tête sous le haut du potelet (mm). */
export function rangDeTete(p: ProjectParams): number {
  const d0 = holeDiameter(p.connections.gusset.bolt);
  return Math.ceil((1.5 * d0 + 5) / 5) * 5;
}

/**
 * Hauteur réservée sous la tête du potelet : le rang de boulons, leur écrou,
 * un jeu. Les attaches de contreventement posées sur le potelet restent dessous.
 */
export function reserveDeTete(p: ProjectParams): number {
  return rangDeTete(p) + p.connections.gusset.bolt.d + 10;
}

/** Ce qui coiffe le potelet, côté gousset. */
interface Coiffe {
  readonly porteur: Member;
  /** Altitude de la face inférieure qui reçoit le gousset. */
  readonly zSous: number;
  /** Largeur disponible pour le cordon, le long de la face (mm). */
  readonly largeur: number;
  readonly libelle: string;
}

export function tetesDePotelets(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  if (!p.frame.enabled || p.truss.enabled) return;
  const bolt = p.connections.gusset.bolt;
  const d0 = holeDiameter(bolt);
  const pince = Math.max(1.5 * d0, minEdgeDistance(bolt));
  const t = p.connections.gusset.thickness;
  const traverses = members.filter((m) => m.role === 'traverse');

  for (const po of members.filter((m) => m.role === 'potelet')) {
    const pr = getProfile(po.profileId);
    if (pr.shape !== 'I') continue;
    const f = memberFrame(po);
    const haut = add(po.start, scale(f.ax, fibreAbscissa(f, po.start, po.cutEnd, { y: 0, z: 0 })));

    /*
     * Côté de l'âme : à l'opposé du gousset de contreventement posé en tête, s'il
     * y en a un — les écrous de l'un viendraient sur l'autre.
     */
    const cv = plates.find(
      (pl) => pl.kind === 'gousset-cv' && pl.porteur === po.id && pl.origin.z > (po.start.z + haut.z) / 2,
    );
    const cotes = cv ? [-(Math.sign(dot(cv.v, f.ay)) || 1)] : [1, -1];

    for (const cote of cotes) {
      const decalage = cote * (pr.tw / 2 + t / 2);
      const plan = add(haut, scale(f.ay, decalage));
      const coiffe = coiffeSousLaquelle(plates, traverses, plan, f.ay, f.az, t, haut.z);
      if (!coiffe) continue;

      const largeur = Math.floor(Math.min(pr.h - 2 * (pr.tf + pr.r) - 10, coiffe.largeur - 10) / 10) * 10;
      const xb = largeur / 2 - pince;
      const zB = haut.z - rangDeTete(p);
      const hauteur = Math.ceil((coiffe.zSous - zB + courseDeTete(p) + d0 / 2 + pince) / 10) * 10;
      const id = `${po.id}-GT`;

      const sBoulons = zB - po.start.z;
      ajouter(
        po.id,
        [-1, 1].map((k) => hole(sBoulons, { y: 0, z: k * xb }, bolt, 'y', 'ame', id)),
      );
      plates.push({
        id,
        kind: 'gousset-tete',
        grade: coiffe.porteur.grade,
        thickness: t,
        outline: [
          { y: -largeur / 2, z: 0 },
          { y: largeur / 2, z: 0 },
          { y: largeur / 2, z: hauteur },
          { y: -largeur / 2, z: hauteur },
        ],
        holes: [-1, 1].map((k) => ({
          at: { y: k * xb, z: coiffe.zSous - zB },
          d: d0,
          oblong: { longueur: d0 + 2 * courseDeTete(p), sens: 'z' as const },
        })),
        pairedWith: null,
        porteur: coiffe.porteur.id,
        origin: v3(plan.x, plan.y, coiffe.zSous),
        u: f.az,
        v: v3(0, 0, -1),
        mark: '',
        position: `gousset de tête de potelet, soudé ${coiffe.libelle} — oblongs ±${courseDeTete(p)} mm — ${po.position}`,
      });
      break;
    }
  }
}

/**
 * La face inférieure qui coiffe le gousset : d'abord une platine de faîtage dont
 * l'épaisseur contient celle du gousset, sinon la semelle inférieure de la
 * traverse du pignon, là où son métal existe.
 */
function coiffeSousLaquelle(
  plates: readonly Plate[],
  traverses: readonly Member[],
  plan: Vec3,
  normale: Vec3,
  largeurAxe: Vec3,
  t: number,
  zHaut: number,
): Coiffe | null {
  const parId = new Map(traverses.map((m) => [m.id, m]));
  for (const pl of plates) {
    if (pl.kind !== 'platine-about' || !pl.porteur) continue;
    const n = normalize(cross(pl.u, pl.v));
    if (Math.abs(dot(n, normale)) < 0.999) continue;
    const ecart = Math.abs(dot(sub(pl.origin, plan), normale));
    if (ecart + t / 2 > pl.thickness / 2 + 0.5) continue;
    const coins = pl.outline.map((q) => add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z))));
    const zSous = Math.min(...coins.map((c) => c.z));
    const xs = coins.map((c) => dot(sub(c, plan), largeurAxe));
    const porteur = parId.get(pl.porteur);
    if (!porteur || zSous < zHaut || zSous > zHaut + 200 || Math.min(...xs) > 0 || Math.max(...xs) < 0) continue;
    return {
      porteur,
      zSous,
      largeur: 2 * Math.min(-Math.min(...xs), Math.max(...xs)),
      libelle: 'sous la platine de faîtage',
    };
  }
  for (const tr of traverses) {
    if (Math.abs(tr.start.x - plan.x) > 1) continue;
    const f = memberFrame(tr);
    if (Math.abs(f.ax.y) < 1e-6) continue;
    const s = (plan.y - tr.start.y) / f.ax.y;
    const axe = { y: 0, z: 0 };
    const s0 = fibreAbscissa(f, tr.start, tr.cutStart, axe);
    const s1 = fibreAbscissa(f, tr.start, tr.cutEnd, axe);
    if (s < Math.min(s0, s1) + 10 + t || s > Math.max(s0, s1) - 10 - t) continue;
    const pr = getProfile(tr.profileId);
    const haut = f.az.z >= 0 ? f.az : scale(f.az, -1);
    const q = sub(add(tr.start, scale(f.ax, s)), scale(haut, pr.h / 2));
    const zSous = q.z - (haut.y * (plan.y - q.y) + haut.x * (plan.x - q.x)) / haut.z;
    if (zSous < zHaut || zSous > zHaut + 200) continue;
    return { porteur: tr, zSous, largeur: pr.b, libelle: 'sous la traverse' };
  }
  return null;
}
