import { getProfile } from '../../catalog/index';
import { EN_ATTENTE, hole, type Hole } from '../../geometry/holes';
import { memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import { dot, sub, type Vec3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance } from '../../model/connections';
import type { ProjectParams } from '../../model/project';

/**
 * ATTACHES DE LISSES — chaque lisse boulonnée sur ce qui la porte.
 *
 * ⚠ Les lisses n'avaient AUCUN perçage, et les poteaux aucun trou pour elles :
 * soixante-douze barres parties de l'atelier sans rien pour les fixer, que le
 * monteur aurait percées sur le chantier, à la main, en hauteur.
 *
 * La lisse est plaquée par l'aile tournée vers le bâtiment sur la face qui la
 * porte : semelle extérieure du poteau en long pan, semelle du potelet ou aile
 * de l'équerre d'angle au pignon. Les boulons traversent cette aile et la paroi
 * porteuse, à l'about de la lisse, autant qu'en loge la largeur d'appui.
 *
 * Comme pour les échantignolles, chaque trou est la PROJECTION d'un même point
 * de boulon dans le repère de chaque pièce : les deux perçages ne peuvent pas
 * diverger, quels que soient les repères.
 */
export function attachesDeLisses(
  p: ProjectParams,
  members: readonly Member[],
  ajouter: (memberId: string, h: Hole[]) => void,
): Map<string, string> {
  const porteurs = new Map<string, string>();
  if (!p.secondary.rails.enabled) return porteurs;
  const bolt = p.connections.secondaryBolt;
  const d0 = holeDiameter(bolt);
  const pince = Math.max(2 * d0, minEdgeDistance(bolt));
  const entraxe = 3 * d0;

  const appuis = members.filter((m) => m.role === 'poteau' || m.role === 'potelet');
  const equerres = members.filter((m) => m.role === 'equerre');

  for (const li of members.filter((m) => m.role === 'lisse')) {
    const pr = getProfile(li.profileId);
    if (pr.shape !== 'U') continue;
    const f = memberFrame(li);
    const l = Math.hypot(li.end.x - li.start.x, li.end.y - li.start.y, li.end.z - li.start.z);
    // Milieu de l'aile, là où se pose le boulon (hors du congé d'âme).
    const yAile = pr.b / 2 - pr.cy;

    for (const bout of ['start', 'end'] as const) {
      const extremite = bout === 'start' ? li.start : li.end;

      /*
       * L'appui à cet about : un poteau ou un potelet dont l'axe vertical est au
       * droit de l'about — ou, aux angles de pignon, l'équerre qui y est posée.
       */
      const equerre = equerres.find(
        (e) => Math.abs(e.start.z - extremite.z) < 400 && horizontale(e.start, extremite) < 260,
      );
      const support =
        equerre ??
        appuis.find(
          (a) =>
            Math.abs(dot(sub(a.start, extremite), f.ax)) < 1 &&
            horizontale(a.start, extremite) < getProfile(a.profileId).h / 2 + pr.h + 1,
        );
      if (!support) continue;

      // Aile de la lisse tournée vers l'appui : celle des deux qui en est la plus proche.
      const zAile = [pr.h / 2, -pr.h / 2].sort(
        (a, b) =>
          horizontale(sectionPointAt(f, li.start, 0, { y: yAile, z: a }), support.start) -
          horizontale(sectionPointAt(f, li.start, 0, { y: yAile, z: b }), support.start),
      )[0] as number;

      // Abscisses des boulons depuis l'about : sur l'équerre, au milieu de son
      // aile ; sur un poteau ou un potelet, autant que la demi-largeur en loge.
      const abscisses = positionsDesBoulons(li, bout, support, pince, entraxe, d0);
      const trousLisse: Hole[] = [];
      const trousAppui: Hole[] = [];
      const fs = memberFrame(support);
      for (const a of abscisses) {
        const s = bout === 'start' ? a : l - a;
        const point = sectionPointAt(f, li.start, s, { y: yAile, z: zAile });
        trousLisse.push(hole(s, { y: yAile, z: zAile }, bolt, 'z', 'aile', support.id));
        const d = sub(point, support.start);
        // L'axe de perçage est la normale à la face de contact : l'axe z de la
        // lisse, qui est selon y ou z dans le repère de l'appui.
        const through: 'y' | 'z' = Math.abs(dot(f.az, fs.az)) > 0.9 ? 'z' : 'y';
        trousAppui.push(
          hole(dot(d, fs.ax), { y: dot(d, fs.ay), z: dot(d, fs.az) }, bolt, through, through === 'z' ? 'semelle-sup' : 'aile', li.id),
        );
      }
      ajouter(li.id, trousLisse);
      ajouter(support.id, trousAppui);
      if (equerre) porteurs.set(equerre.id, poteauDe(equerre, appuis)?.id ?? '');
    }
  }
  for (const [k, v] of porteurs) if (!v) porteurs.delete(k);
  return porteurs;
}

/**
 * Poteaux PERCÉS À L'IDENTIQUE pour les lisses : chaque trou de lisse reçoit son
 * symétrique de l'autre côté de l'axe du poteau, en attente s'il ne sert pas.
 *
 * ⚠ Un poteau d'angle ne reçoit de lisse que d'un côté. Percé au plus juste, il
 * prenait un repère à lui — et la file entière de poteaux se scindait en deux
 * repères pour deux trous. On les perce tous comme les poteaux courants.
 */
export function percerPoteauxEnSymetrie(members: readonly Member[], trous: Map<string, Hole[]>): void {
  const lisses = new Set(members.filter((m) => m.role === 'lisse').map((m) => m.id));
  for (const po of members.filter((m) => m.role === 'poteau')) {
    const l = trous.get(po.id);
    if (!l) continue;
    const manquants = l
      .filter((h) => lisses.has(h.from))
      .filter((h) => !l.some((k) => Math.abs(k.s - h.s) < 0.5 && Math.abs(k.at.y + h.at.y) < 0.5 && Math.abs(k.at.z - h.at.z) < 0.5))
      .map((h) => ({ ...h, at: { y: -h.at.y, z: h.at.z }, from: EN_ATTENTE }));
    l.push(...manquants);
  }
}

/** Distance horizontale entre deux points. */
function horizontale(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Abscisses des boulons depuis l'about de la lisse.
 *
 * ⚠ Sur un poteau, la largeur d'appui est la DEMI-semelle : la lisse voisine
 * s'appuie sur l'autre moitié. Deux boulons à 26 et 65 mm tiennent dans les
 * 90 mm d'un IPE 400, pas dans les 60 d'un IPE 240 — on n'en pose alors qu'un.
 */
function positionsDesBoulons(
  li: Member,
  bout: 'start' | 'end',
  support: Member,
  pince: number,
  entraxe: number,
  d0: number,
): number[] {
  const f = memberFrame(li);
  const extremite = bout === 'start' ? li.start : li.end;
  const sens = bout === 'start' ? 1 : -1;
  const pr = getProfile(support.profileId);
  if (support.role === 'equerre' && pr.shape === 'L') {
    // L'aile boulonnée de l'équerre : de son talon, sur la longueur de l'aile.
    const fs = memberFrame(support);
    const talon = sectionPointAt(fs, support.start, 0, { y: -pr.cy, z: -pr.cz });
    const bout1 = dot(sub(talon, extremite), f.ax) * sens;
    const bout2 = bout1 - pr.a * Math.sign(bout1 || 1);
    const milieu = (bout1 + bout2) / 2;
    return [milieu - entraxe / 2, milieu + entraxe / 2].map((x) => Math.abs(x));
  }
  const demi = pr.b / 2;
  /*
   * ⚠ L'about de la lisse est sur l'axe du poteau : à 26 mm de lui, la tête du
   * boulon tombait dans le congé de l'âme — 4,3 + 21 mm sur un IPE 400 —, ni
   * posable ni serrable. Le premier boulon s'écarte de l'âme du congé, plus le
   * rayon de l'écrou, plus un jeu.
   */
  const ame = pr.shape === 'I' || pr.shape === 'U' ? pr.tw / 2 + pr.r : 0;
  const premier = Math.ceil(Math.max(pince, ame + rayonDeCle(d0) + 2));
  const out = [premier];
  // Second boulon à 3 d0 si la demi-semelle le loge, jusqu'à l'entraxe mini de 2,2 d0.
  const second = premier + Math.max(2.2 * d0, Math.min(entraxe, demi - 1.2 * d0 - premier));
  if (second + 1.2 * d0 <= demi) out.push(Math.round(second));
  return out;
}

/** Demi-diagonale d'un écrou hexagonal pour un trou d0 : 0,87 × le diamètre nominal. */
function rayonDeCle(d0: number): number {
  return 0.87 * (d0 - 1);
}

/** Le poteau d'angle sur lequel une équerre est soudée : le plus proche. */
function poteauDe(e: Member, appuis: readonly Member[]): Member | undefined {
  return appuis
    .filter((a) => a.role === 'poteau')
    .sort((a, b) => horizontale(a.start, e.start) - horizontale(b.start, e.start))[0];
}
