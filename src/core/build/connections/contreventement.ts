import { getProfile } from '../../catalog/index';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import type { Pt2 } from '../../geometry/section';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance, type BoltSpec } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import type { Plate } from '../types';
import { rectangle } from './geom';

/**
 * ATTACHES DES DIAGONALES DE CONTREVENTEMENT — plat soudé dans le tube fendu,
 * boulonné sur un gousset soudé sur la pièce porteuse.
 *
 * ⚠ Les diagonales partaient sans rien à leurs abouts : ni gousset sur les
 * poteaux, ni plat dans les tubes, ni boulon. Le monteur recevait des tubes
 * coupés d'équerre à poser contre… rien.
 *
 * Le détail est le plus courant en charpente : l'about du tube est FENDU, un plat
 * y est engagé et soudé sur les deux lèvres de la fente ; le plat dépasse et se
 * boulonne sur un gousset soudé en atelier sur la pièce porteuse :
 *  - sur son ÂME, entre les semelles, quand le plan de la maille est parallèle aux
 *    semelles — palées sur les poteaux, poutre au vent sur les traverses,
 *    contreventement de pignon sur les potelets ;
 *  - sur sa SEMELLE, quand ce plan est parallèle à l'âme — le poteau d'angle vu
 *    depuis le pignon.
 *
 * Toute la géométrie de l'attache est décidée ICI, une fois : l'ébout du tube,
 * la position des deux boulons, le plat et le gousset s'en déduisent. Le tube ne
 * peut pas s'arrêter ailleurs qu'au bout de son plat, ni le plat être percé
 * ailleurs que son gousset.
 */

export type TypeDAppui = 'ame' | 'semelle';

/**
 * Disposition d'une attache, dans le repère de la maille : les distances λ se
 * comptent depuis le point de travail, le long de la diagonale, vers le tube.
 */
export interface Disposition {
  readonly appui: string;
  readonly type: TypeDAppui;
  /** Point de travail, sur l'axe de la pièce porteuse. */
  readonly travail: Vec3;
  /** Direction de la diagonale, du point de travail vers le tube. */
  readonly a: Vec3;
  /** Normale au plan de la maille, qui est aussi celle du gousset et du plat. */
  readonly n: Vec3;
  /** Repère du gousset : e1 le long de la pièce porteuse, e2 vers le tube. */
  readonly e1: Vec3;
  readonly e2: Vec3;
  /** Décalage de l'axe du tube selon n (mm). */
  readonly decalage: number;
  /** Décalage du plan moyen du gousset selon n (mm). */
  readonly gousset: number;
  /** Distance de la face soudée à l'axe de la pièce porteuse, selon e2 (mm). */
  readonly face: number;
  /** Abscisses λ des boulons (mm). */
  readonly boulons: readonly number[];
  /** Abscisse λ de l'about du tube (mm). */
  readonly about: number;
  /** Abscisse λ du fond du plat, engagé dans la fente (mm). */
  readonly fond: number;
  /** Abscisse λ du bout libre du plat (mm). */
  readonly bout: number;
  readonly largeurPlat: number;
  readonly epaisseur: number;
  readonly bolt: BoltSpec;
  /** Plage permise au gousset le long de la pièce porteuse, depuis le point de travail. */
  readonly limites: readonly [number, number];
}

/** Ce que la construction des contreventements transmet aux assemblages. */
export interface AttacheCV {
  readonly tube: string;
  readonly bout: 'start' | 'end';
  readonly disposition: Disposition;
}

/** Jeu entre une tôle et ce qu'elle longe sans y être soudée (mm). */
const JEU = 10;

/** Longueur engagée dans la fente : 1,5 D, 80 mm au moins — celle des cordons. */
export function longueurDeFente(diametre: number): number {
  return Math.max(80, Math.ceil((1.5 * diametre) / 10) * 10);
}

const plafond5 = (v: number): number => Math.ceil(v / 5 - 1e-9) * 5;

/**
 * Disposition de l'attache d'une diagonale sur une pièce porteuse, ou `null` si
 * cette pièce ne peut pas la recevoir — profil qui n'est pas en I, plan de maille
 * qui ne coïncide ni avec ses semelles ni avec son âme, place insuffisante entre
 * ses coupes.
 *
 * @param plafond  altitude au-dessus de laquelle le gousset ne peut monter, selon
 *   qu'il est sur l'âme ou sur la semelle : le bas de la platine de genou pour un
 *   gousset de semelle de poteau, la réserve de tête pour un potelet.
 */
export function dispositionDAttache(
  p: ProjectParams,
  appui: Member,
  travail: Vec3,
  a: Vec3,
  n: Vec3,
  decalage: number,
  diametreTube: number,
  plafond?: (type: TypeDAppui) => number | undefined,
): Disposition | null {
  const pr = getProfile(appui.profileId);
  if (pr.shape !== 'I') return null;
  const f = memberFrame(appui);
  const e1 = f.ax;
  let type: TypeDAppui;
  let face: number;
  let obstacle: number;
  if (Math.abs(dot(n, f.az)) > 0.999) {
    type = 'ame';
    face = pr.tw / 2;
    obstacle = pr.b / 2;
  } else if (Math.abs(dot(n, f.ay)) > 0.999) {
    type = 'semelle';
    face = pr.h / 2;
    obstacle = pr.h / 2;
  } else return null;

  let e2 = normalize(cross(n, e1));
  if (dot(a, e2) < 0) e2 = scale(e2, -1);
  const c1 = dot(a, e1);
  const c2 = dot(a, e2);
  // Diagonale presque parallèle à la pièce, ou sortie du plan de la maille.
  if (c2 < 0.2 || Math.abs(dot(a, n)) > 1e-6) return null;

  const t = p.connections.gusset.thickness;
  const bolt = p.connections.gusset.bolt;
  const d0 = holeDiameter(bolt);
  const pince = Math.max(1.5 * d0, minEdgeDistance(bolt));
  const entraxe = 3 * d0;
  const largeurPlat = Math.ceil((diametreTube + 20) / 10) * 10;

  /*
   * Plage de la pièce porteuse où le gousset peut se souder : entre ses deux
   * coupes — au-delà, il y a la platine de genou, de faîtage ou de pied —, avec
   * un jeu ; sous la platine de genou pour un gousset de semelle.
   */
  const sTravail = dot(sub(travail, appui.start), e1);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, appui.start, appui.cutStart, axe);
  const s1 = fibreAbscissa(f, appui.start, appui.cutEnd, axe);
  let haut = Math.max(s0, s1) - sTravail - JEU;
  const bas = Math.min(s0, s1) - sTravail + JEU;
  const zMax = plafond?.(type);
  if (zMax !== undefined && Math.abs(e1.z) > 0.5) {
    haut = Math.min(haut, (zMax - travail.z) / e1.z - JEU);
  }

  /*
   * Premier boulon : le plus près possible de la pièce porteuse, mais
   *  - au-delà des rives de semelle (ou de la face de semelle) de deux diamètres
   *    de trou, pour la clé ;
   *  - assez loin pour que les coins du plat ne touchent pas la face soudée ;
   *  - avec les deux boulons, et la pince, entre les limites du gousset — et le
   *    plat, coins compris, aussi.
   */
  const demiPlat = largeurPlat / 2;
  const mini = [
    0,
    (obstacle + 2 * d0) / c2,
    (face + 5 + demiPlat * Math.abs(c1)) / c2 + pince,
  ];
  const maxi: number[] = [];
  // Abscisse le long de la pièce : β = λ·c1, à garder dans [bas + pince, haut − pince]
  // pour les boulons, et le coin du plat le plus avancé dans [bas, haut].
  if (Math.abs(c1) > 1e-6) {
    const vers = c1 > 0 ? haut : bas;
    const depuis = c1 > 0 ? bas : haut;
    const signe = Math.sign(c1);
    mini.push((depuis + signe * pince) / c1);
    mini.push(pince + (depuis + signe * demiPlat * c2) / c1);
    maxi.push((vers - signe * pince) / c1 - entraxe);
  } else if (bas + pince > 0 || haut - pince < 0) return null;
  const lambda1 = plafond5(Math.max(...mini));
  if (maxi.some((m) => lambda1 > m + 1e-6)) return null;
  const lambda2 = lambda1 + entraxe;

  /*
   * About du tube : au-delà du gousset (qu'il chevaucherait, l'axe du tube
   * n'étant qu'à une épaisseur de lui), de la tête du dernier boulon, et de la
   * face soudée.
   */
  const about = plafond5(
    Math.max(
      lambda2 + Math.max(1.1 * pince + 5, 0.9 * bolt.d + 10),
      (face + 5 + (diametreTube / 2) * Math.abs(c1)) / c2,
    ),
  );
  const signeDecalage = decalage >= 0 ? 1 : -1;
  return {
    appui: appui.id,
    type,
    travail,
    a,
    n,
    e1,
    e2,
    decalage,
    gousset: decalage - signeDecalage * t,
    face,
    boulons: [lambda1, lambda2],
    about,
    fond: about + longueurDeFente(diametreTube),
    bout: lambda1 - pince,
    largeurPlat,
    epaisseur: t,
    bolt,
    limites: [bas, haut],
  };
}

/** Extrémité du tube que l'attache impose : sur son axe décalé, à l'about. */
export function aboutDuTube(d: Disposition): Vec3 {
  return add(add(d.travail, scale(d.n, d.decalage)), scale(d.a, d.about));
}

/* ------------------------------------------------------------------ */

/**
 * Les tôles des attaches : un plat par about de tube, un gousset par nœud.
 *
 * ⚠ Deux diagonales qui arrivent au MÊME nœud dans le même plan — les deux brins
 * d'une palée en K — partagent un gousset : deux tôles superposées ne se
 * soudent pas l'une sur l'autre.
 */
export function attachesDeContreventement(
  p: ProjectParams,
  attaches: readonly AttacheCV[],
  plates: Plate[],
): void {
  const grade = p.bracing.grade;
  const noeuds = new Map<string, Disposition[]>();
  for (const at of attaches) {
    const d = at.disposition;
    plates.push(platDeTube(at, grade));
    // Même pièce, même nœud, même plan, et même CÔTÉ de l'âme : deux goussets
    // de part et d'autre d'une âme ne se confondent pas en une tôle qui la traverse.
    const cote = `${Math.round(d.e2.x)},${Math.round(d.e2.y)},${Math.round(d.e2.z)}`;
    const cle = `${d.appui}|${Math.round(d.travail.x)},${Math.round(d.travail.y)},${Math.round(d.travail.z)}|${Math.round(d.gousset)}|${cote}`;
    noeuds.set(cle, [...(noeuds.get(cle) ?? []), d]);
  }
  let k = 0;
  for (const ds of noeuds.values()) plates.push(goussetDuNoeud(ds, `GC${k++}`, grade));
}

function platDeTube(at: AttacheCV, grade: Plate['grade']): Plate {
  const d = at.disposition;
  const milieu = (d.bout + d.fond) / 2;
  return {
    id: `${at.tube}-PC${at.bout === 'start' ? 0 : 1}`,
    kind: 'plat-tube',
    grade,
    thickness: d.epaisseur,
    outline: rectangle(d.fond - d.bout, d.largeurPlat),
    holes: d.boulons.map((l) => ({ at: { y: l - milieu, z: 0 }, d: holeDiameter(d.bolt) })),
    pairedWith: null,
    porteur: at.tube,
    origin: add(add(d.travail, scale(d.n, d.decalage)), scale(d.a, milieu)),
    u: d.a,
    v: normalize(cross(d.n, d.a)),
    mark: '',
    position: `plat d’about de diagonale, soudé dans la fente du tube`,
  };
}

/**
 * Gousset d'un nœud : l'enveloppe convexe des boulons, chacun entouré de sa
 * pince, et du cordon sur la pièce porteuse — la forme que le découpeur trace
 * autour de la ligne de boulons.
 */
function goussetDuNoeud(ds: readonly Disposition[], suffixe: string, grade: Plate['grade']): Plate {
  const d = ds[0] as Disposition;
  const pince = Math.max(1.5 * holeDiameter(d.bolt), minEdgeDistance(d.bolt));
  const trous = ds.flatMap((x) =>
    x.boulons.map((l) => ({ y: l * dot(x.a, d.e1), z: l * dot(x.a, d.e2) - d.face })),
  );
  const r = pince / Math.cos(Math.PI / 8);
  const points: Pt2[] = trous.flatMap((h) =>
    Array.from({ length: 8 }, (_, i) => ({
      y: h.y + r * Math.cos(((i + 0.5) * Math.PI) / 4),
      z: h.z + r * Math.sin(((i + 0.5) * Math.PI) / 4),
    })),
  );
  const ys = trous.map((h) => h.y);
  points.push({ y: Math.min(...ys) - pince, z: 0 }, { y: Math.max(...ys) + pince, z: 0 });
  const [bas, haut] = d.limites;
  const contour = decouper(enveloppe(points), bas, haut).map((q) => ({
    y: Math.round(q.y * 10) / 10,
    z: Math.max(0, Math.round(q.z * 10) / 10),
  }));
  return {
    id: `${d.appui}-${suffixe}`,
    kind: 'gousset-cv',
    grade,
    thickness: d.epaisseur,
    outline: contour,
    holes: trous.map((h) => ({ at: h, d: holeDiameter(d.bolt) })),
    pairedWith: null,
    porteur: d.appui,
    origin: add(add(d.travail, scale(d.n, d.gousset)), scale(d.e2, d.face)),
    u: d.e1,
    v: d.e2,
    mark: '',
    position: `gousset de contreventement soudé sur ${d.type === 'ame' ? 'l’âme' : 'la semelle'}`,
  };
}

/** Longueur du cordon d'un gousset : son bord posé sur la pièce porteuse (z = 0). */
export function longueurSoudeeDuGousset(pl: Plate): number {
  const ys = pl.outline.filter((q) => Math.abs(q.z) < 0.5).map((q) => q.y);
  return ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
}

/**
 * Engagement d'un plat dans son tube : à quel about, sur quelle longueur — celle
 * de la fente et des cordons —, et de combien il en dépasse.
 */
export function fenteDuPlat(
  tube: Member,
  pl: Plate,
): { about: 'origine' | 'extremite'; longueur: number; saillie: number } {
  const f = memberFrame(tube);
  const s = pl.outline.map((q) =>
    dot(sub(add(pl.origin, add(scale(pl.u, q.y), scale(pl.v, q.z))), tube.start), f.ax),
  );
  const sMin = Math.min(...s);
  const sMax = Math.max(...s);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, tube.start, tube.cutStart, axe);
  const s1 = fibreAbscissa(f, tube.start, tube.cutEnd, axe);
  return sMin < s0 + 1e-6
    ? { about: 'origine', longueur: sMax - s0, saillie: s0 - sMin }
    : { about: 'extremite', longueur: s1 - sMin, saillie: sMax - s1 };
}

/* ------------------------------------------------------------------ */

/** Enveloppe convexe (monotone chain), sens trigonométrique. */
function enveloppe(points: readonly Pt2[]): Pt2[] {
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

/** Découpe d'un polygone convexe entre deux droites y = bas et y = haut. */
function decouper(poly: readonly Pt2[], bas: number, haut: number): Pt2[] {
  const coupe = (pts: readonly Pt2[], dedans: (q: Pt2) => boolean, y0: number): Pt2[] => {
    const out: Pt2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as Pt2;
      const b = pts[(i + 1) % pts.length] as Pt2;
      if (dedans(a)) out.push(a);
      if (dedans(a) !== dedans(b)) {
        const t = (y0 - a.y) / (b.y - a.y);
        out.push({ y: y0, z: a.z + t * (b.z - a.z) });
      }
    }
    return out;
  };
  return coupe(coupe(poly, (q) => q.y >= bas, bas), (q) => q.y <= haut, haut);
}
