import { getProfile } from '../../catalog/index';
import { EN_ATTENTE, hole, type Hole } from '../../geometry/holes';
import { memberFrame, type Member } from '../../geometry/member';
import { add, dot, scale, sub } from '../../math/vec3';
import { holeDiameter, minEdgeDistance } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import { distanceAuSegment, longueurAxe, pointSurLAxe } from './geom';

/**
 * ATTACHES DE PANNES ET DE LISSES.
 *
 * Ce module ne pose que les PERÇAGES. L'échantignolle elle-même est une vraie
 * pièce à débiter et à repérer — elle est construite avec l'ossature secondaire
 * et apparaît à la nomenclature comme n'importe quelle autre barre.
 */

/**
 * Échantignoles : chaque panne est fixée sur la pièce porteuse par deux boulons,
 * à chaque croisement. La panne est donc percée dans sa semelle inférieure au
 * droit de chaque portique.
 */
/**
 * Où percer la semelle inférieure d'une panne, dans le repère de sa section.
 *
 * ⚠ Deux repères à ne pas confondre. `z` est la cote de la semelle depuis le
 * CENTRE DE GRAVITÉ — donc −h/2 sur un profil symétrique, mais −cz sur un Z,
 * dont les ailes inégales décalent le centre de gravité. `yCentre` est le milieu
 * de la semelle : zéro sur un I, dont l'aile est centrée sur l'âme, mais décalé
 * sur un Z ou un C, dont l'aile part d'un seul côté.
 *
 * ⚠⚠ Sans ce décalage, les deux boulons se posaient de part et d'autre de l'axe
 * — soit, sur un Z, l'un dans la semelle et l'AUTRE DANS LE VIDE. Le profil
 * n'était de toute façon pas percé du tout : la génération s'arrêtait aux
 * seules formes en I et en U, et une panne formée à froid serait partie en
 * peinture sans un trou pour la fixer.
 *
 * Renvoie `null` pour une forme sans semelle où poser un boulon vertical.
 */
export function semelleInferieure(
  profil: ReturnType<typeof getProfile>,
): { z: number; yCentre: number } | null {
  if (profil.shape === 'I' || profil.shape === 'U') {
    return { z: -profil.h / 2, yCentre: 0 };
  }
  if (profil.shape === 'Z' || profil.shape === 'C') {
    // L'aile basse du catalogue est la plus large, et part vers les y positifs.
    return { z: -profil.cz, yCentre: (profil.t + profil.aile) / 2 - profil.cy };
  }
  return null;
}

export function attachesDePannes(
  p: ProjectParams,
  members: readonly Member[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  if (!p.secondary.purlins.enabled) return;
  const bolt = p.connections.secondaryBolt;
  const entraxe = 3 * holeDiameter(bolt);

  // ⚠ Une pince est indispensable : un boulon posé à l'about même déchirerait la
  // semelle, et de toute façon aucun outil ne perce à 0 mm du bout d'une barre.
  const pince = Math.max(2 * holeDiameter(bolt), minEdgeDistance(bolt));
  const attaches = members.filter((m) => m.role === 'attache');

  for (const pa of members.filter((m) => m.role === 'panne')) {
    const profil = getProfile(pa.profileId);
    const semelle = semelleInferieure(profil);
    if (!semelle) continue;
    const l = longueurAxe(pa);
    if (l < 4 * pince) continue; // panne trop courte pour être boulonnée aux deux bouts

    const fPanne = memberFrame(pa);

    // Une panne débitée par travée repose sur un appui à chacun de ses abouts,
    // le boulon étant reculé de sa pince.
    for (const s of [pince, l - pince]) {
      // ⚠ Le boulon n'est pas sur l'axe de la panne mais dans sa SEMELLE
      // INFÉRIEURE : c'est depuis ce point-là qu'il faut chercher la cornière,
      // sinon on la cherche à 120 mm de sa position réelle et on ne la trouve pas.
      const point = add(
        pointSurLAxe(pa, s),
        scale(fPanne.az, semelle.z),
      );
      // Tolérance déduite de l'empilage réel des pièces, pas choisie au hasard.
      const portee = -semelle.z + getProfile(p.connections.purlinCleat.profile).h + 20;
      const cleat = attaches.find((c) => distanceAuSegment(point, c) < portee);
      const provenance = cleat ? cleat.id : 'échantignole';

      const trousPanne: Hole[] = [];
      const trousCleat: Hole[] = [];
      for (let k = 0; k < 2; k++) {
        const y = semelle.yCentre + (k - 0.5) * entraxe;
        trousPanne.push(
          hole(s, { y, z: semelle.z }, bolt, 'z', 'semelle-inf', provenance),
        );
        if (cleat) {
          const profilCleat = getProfile(cleat.profileId);
          if (profilCleat.shape !== 'L') continue;
          /*
           * ⚠ Le trou de la cornière est la PROJECTION du point du boulon dans
           * le repère de la cornière, et non une copie de la cote de la panne :
           * les deux repères ne sont pas orientés pareil — celui de la cornière
           * est retourné —, et recopier `y` posait le trou en miroir.
           */
          const boulon = add(
            add(pointSurLAxe(pa, s), scale(fPanne.ay, y)),
            scale(fPanne.az, semelle.z),
          );
          const fCleat = memberFrame(cleat);
          const d = sub(boulon, cleat.start);
          trousCleat.push(
            hole(
              dot(d, fCleat.ax),
              // Le boulon traverse l'aile couchée de la cornière, en son milieu.
              { y: dot(d, fCleat.ay), z: -profilCleat.cz + profilCleat.t / 2 },
              bolt,
              'z',
              'aile',
              pa.id,
            ),
          );
        }
      }
      ajouter(pa.id, trousPanne);
      if (cleat && trousCleat.length > 0) ajouter(cleat.id, trousCleat);
    }
  }
}

/**
 * Échantignolles PERCÉES À L'IDENTIQUE : chaque trou reçoit son symétrique par
 * rapport au milieu de la cornière, en attente s'il ne sert pas.
 *
 * ⚠ Sans cela, l'échantignolle de pignon — une seule panne, deux trous — n'était
 * pas celle des files courantes — deux pannes, quatre trous. Trois repères de
 * cornière, et surtout six variantes de chaque traverse, de chaque poteau et
 * de chaque console : un atelier ne fabrique pas ainsi, il perce toutes les
 * échantignolles pareil et laisse au pignon deux trous sans boulon.
 */
export function percerEnSymetrie(
  members: readonly Member[],
  trous: Map<string, Hole[]>,
): void {
  for (const at of members.filter((m) => m.role === 'attache')) {
    const l = trous.get(at.id);
    if (!l || l.length === 0) continue;
    const longueur = longueurAxe(at);
    const manquants = l
      .filter(
        (h) =>
          !l.some(
            (k) => Math.abs(k.s - (longueur - h.s)) < 0.5 && Math.abs(k.at.y - h.at.y) < 0.5,
          ),
      )
      .map((h) => ({ ...h, s: longueur - h.s, from: EN_ATTENTE }));
    l.push(...manquants);
  }
}
