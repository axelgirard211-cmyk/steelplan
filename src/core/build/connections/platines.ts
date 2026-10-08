import { getProfile } from '../../catalog/index';
import { boltGrid, hole, pitchFor, type Hole } from '../../geometry/holes';
import { memberFrame, type Member } from '../../geometry/member';
import { add, cross, dot, normalize, scale, sub, v3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance, positionsDesAncrages, tigeDAncrage } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import type { Plate, PlateHole } from '../types';
import { consoleDeDebord, genou } from '../genou';
import { leftSlopeRad, ridgeHeight, rightSlopeRad } from '../../model/grid';
import { rectangle, surLAxe } from './geom';

/**
 * Platines : pieds de poteaux, genoux traverse-poteau, faîtages.
 *
 * Une platine est SOUDÉE sur la pièce qu'elle termine et BOULONNÉE sur ce qui
 * lui fait face. C'est ce partage qui décide, pour chaque assemblage, laquelle
 * des deux pièces part percée en atelier — et cette décision est prise ici, une
 * seule fois, pour la tôle et pour la barre.
 */

/* ------------------------------------------------------------------ */
/* Pieds de poteaux                                                    */
/* ------------------------------------------------------------------ */

/**
 * Platine de pied soudée sous le poteau, avec ses tiges d'ancrage.
 * Le poteau lui-même n'est pas percé : la platine est soudée.
 */
export function piedsDePoteaux(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
): void {
  const cb = p.connections.columnBase;
  const { dTrou } = tigeDAncrage(cb);
  const trous: PlateHole[] = positionsDesAncrages(cb).map((at) => ({ at, d: dTrou }));

  for (const po of members.filter((m) => m.role === 'poteau')) {
    const f = memberFrame(po);
    // Repère de la tôle : elle est horizontale, sous le pied du poteau.
    // u suit la largeur de platine (X), v sa longueur (Y).
    const u = f.ay;
    const vAxe = f.az;

    plates.push({
      id: `${po.id}-PLP`,
      kind: 'platine-pied',
      grade: po.grade,
      thickness: cb.thickness,
      outline: rectangle(cb.width, cb.length),
      holes: trous,
      pairedWith: null,
      porteur: po.id,
      // La platine est sous le pied, sa face supérieure au contact de l'about.
      origin: add(po.start, scale(f.ax, -cb.thickness / 2)),
      u,
      v: vAxe,
      mark: '',
      position: `pied de poteau — ${po.position}`,
    });
  }
}

/** Épaisseur d'une platine de pied de potelet (mm) : articulée, elle ne fléchit pas. */
export const EPAISSEUR_PIED_POTELET = 15;

/**
 * Pied de potelet : platine soudée, deux tiges d'ancrage.
 *
 * ⚠ Les potelets partaient sans pied : ni platine, ni tige, ni trace sur le plan
 * d'implantation. Le maçon coulait la longrine du pignon sans une réservation,
 * et le monteur recevait des poteaux à poser sur rien.
 *
 * Le pied est ARTICULÉ, comme le calcul le suppose : deux tiges sur l'axe
 * neutre de flexion forte, de part et d'autre de l'âme — le vent qui fléchit le
 * potelet ne les met pas en bras de levier. Elles ont le DIAMÈTRE des tiges de
 * poteaux — un seul gabarit de scellement sur le chantier —, leur longueur
 * suivant la platine plus mince qu'elles traversent. L'écartement loge la rondelle d'ancrage (2,5 d) entre l'âme et sa
 * soudure ; la platine déborde la section de 15 mm pour le cordon.
 */
export function piedsDePotelets(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
): void {
  const cb = p.connections.columnBase;
  const { bolt, dTrou } = tigeDAncrage(cb);
  const pince = Math.max(1.5 * dTrou, minEdgeDistance(bolt));
  const ep = EPAISSEUR_PIED_POTELET;
  const arrondi = (v: number): number => Math.ceil(v / 10) * 10;

  for (const po of members.filter((m) => m.role === 'potelet')) {
    const pr = getProfile(po.profileId);
    if (pr.shape !== 'I') continue;
    const f = memberFrame(po);
    const ecart = pr.tw / 2 + 6 + 1.25 * bolt.d + 5;
    const largeur = arrondi(2 * Math.max(ecart + pince, pr.b / 2 + 15));
    const longueur = arrondi(pr.h + 30);
    plates.push({
      id: `${po.id}-PLP`,
      kind: 'platine-pied',
      grade: po.grade,
      thickness: ep,
      outline: rectangle(largeur, longueur),
      holes: [-1, 1].map((sy) => ({ at: { y: sy * ecart, z: 0 }, d: dTrou })),
      pairedWith: null,
      porteur: po.id,
      origin: add(po.start, scale(f.ax, -ep / 2)),
      u: f.ay,
      v: f.az,
      mark: '',
      position: `pied de potelet — ${po.position}`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Genoux : platine d'about traverse-poteau                            */
/* ------------------------------------------------------------------ */

/**
 * Assemblage traverse-poteau.
 *
 * La traverse (renforcée par son jarret) se termine sur une platine d'about
 * verticale, SOUDÉE sur elle et boulonnée à travers la SEMELLE INTÉRIEURE du
 * poteau. La géométrie entière vient de `genou` — la même fonction qui a donné
 * au poteau sa coupe de tête et à la traverse sa coupe d'about.
 *
 * Conséquence sur le débit : la traverse n'est PAS percée — sa platine est
 * soudée — mais le poteau l'est, sur toute la hauteur de la platine.
 */
export function genoux(
  p: ProjectParams,
  members: readonly Member[],
  parId: Map<string, Member>,
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const ep = p.connections.rafterToColumn;

  for (const po of members.filter((m) => m.role === 'poteau')) {
    const profilPoteau = getProfile(po.profileId);
    if (profilPoteau.shape !== 'I') continue;

    // La traverse assemblée sur ce poteau est celle dont un about est au point
    // de travail de sa tête.
    const traverse = members.find(
      (m) => m.role === 'traverse' && parId.has(m.id) && surLAxe(po.end, m, 2),
    );
    if (!traverse) continue;
    const autreBout =
      Math.hypot(traverse.start.x - po.end.x, traverse.start.y - po.end.y, traverse.start.z - po.end.z) < 2
        ? traverse.end
        : traverse.start;
    const g = genou(
      p,
      po.end,
      normalize(sub(autreBout, po.end)),
      po.profileId,
      traverse.profileId,
      p.frame.haunch.enabled,
    );

    const f = memberFrame(po);
    const pitch = pitchFor(g.platine.hauteurUtile, ep.rows, ep.edgeDistance);
    const grille = boltGrid(ep.rows, ep.cols, pitch, ep.gauge);
    const signe = g.platine.centre.y > po.end.y ? 1 : -1;
    const zSemelle = (signe * profilPoteau.h) / 2;
    // Le poteau est vertical, son abscisse est l'altitude depuis le pied. La
    // grille est centrée sur la bande utile, pas sur la tôle qui déborde en bas.
    const sCentre = g.platine.zGrille - po.start.z;
    const decalage = g.platine.zGrille - g.platine.centre.z;

    ajouter(
      po.id,
      grille.map((q) =>
        hole(
          sCentre + q.z,
          { y: q.y, z: zSemelle },
          ep.bolt,
          'z',
          signe > 0 ? 'semelle-sup' : 'semelle-inf',
          // Provenance : la platine avec laquelle ces trous font paire.
          `${po.id}-PLA`,
        ),
      ),
    );

    plates.push({
      id: `${po.id}-PLA`,
      kind: 'platine-about',
      grade: traverse.grade,
      thickness: ep.thickness,
      outline: rectangle(g.platine.largeur, g.platine.hauteur),
      holes: grille.map((q) => ({ at: { y: q.y, z: q.z + decalage }, d: holeDiameter(ep.bolt) })),
      // Elle se boulonne sur la SEMELLE du poteau, pas sur une autre tôle : ses
      // boulons sont déjà comptés côté poteau.
      pairedWith: null,
      /*
       * ⚠ SOUDÉE SUR LA TRAVERSE, boulonnée sur le poteau. Son identifiant est
       * tiré du poteau — c'est lui qui la localise et que citent ses perçages —
       * et la règle de rattachement par préfixe la soudait donc au poteau : le
       * plan du poteau montrait une platine à souder sur sa semelle, celui de la
       * traverse un about nu. Le porteur se déclare, il ne se devine pas.
       */
      porteur: traverse.id,
      origin: g.platine.centre,
      u: f.ay,
      v: v3(0, 0, 1),
      mark: '',
      position: `platine d’about traverse-poteau — ${po.position}`,
    });
  }
}

/**
 * Platine de CONSOLE DE DÉBORD, boulonnée sur la semelle EXTÉRIEURE du poteau :
 * deux rangées, aux fibres hautes et basses, suffisent à reprendre le moment
 * d'un porte-à-faux de quelques décimètres.
 */
export function consoles(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const ep = p.connections.rafterToColumn;
  for (const co of members.filter((m) => m.role === 'console')) {
    const po = members.find(
      (m) => m.role === 'poteau' && Math.hypot(m.end.x - co.start.x, m.end.y - co.start.y, m.end.z - co.start.z) < 2,
    );
    if (!po || getProfile(po.profileId).shape !== 'I') continue;
    const c = consoleDeDebord(p, po.end, normalize(sub(co.end, co.start)), po.profileId, co.profileId);
    const profilPoteau = getProfile(po.profileId);
    const f = memberFrame(po);
    const pitch = pitchFor(c.platine.hauteurUtile, 2, ep.edgeDistance);
    const decalage = c.platine.zGrille - c.platine.centre.z;
    const grille = boltGrid(2, ep.cols, pitch, ep.gauge);
    const signe = c.platine.centre.y > po.end.y ? 1 : -1;
    const id = `${co.id}-PLC`;

    ajouter(
      po.id,
      grille.map((q) =>
        hole(
          c.platine.zGrille - po.start.z + q.z,
          { y: q.y, z: (signe * profilPoteau.h) / 2 },
          ep.bolt,
          'z',
          signe > 0 ? 'semelle-sup' : 'semelle-inf',
          id,
        ),
      ),
    );
    plates.push({
      id,
      kind: 'platine-about',
      grade: co.grade,
      thickness: ep.thickness,
      outline: rectangle(c.platine.largeur, c.platine.hauteur),
      holes: grille.map((q) => ({ at: { y: q.y, z: q.z + decalage }, d: holeDiameter(ep.bolt) })),
      pairedWith: null,
      porteur: co.id,
      origin: c.platine.centre,
      u: f.ay,
      v: v3(0, 0, 1),
      mark: '',
      position: `platine de console — ${co.position}`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Faîtage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Assemblage de faîtage : les deux traverses se terminent chacune sur une
 * platine verticale, les deux platines étant boulonnées l'une contre l'autre.
 * Aucune des traverses n'est percée.
 */
/**
 * Dimensions de la platine de faîtage — largeur selon la semelle, hauteur selon
 * l'âme —, affleurant le dessus de traverse ; `dessous` est sa profondeur sous
 * le point de travail du faîtage.
 *
 * ⚠ Exportée parce que le potelet placé sous le faîtage doit s'arrêter sous
 * elle : la platine déborde la traverse de `overhang` vers le bas, et le potelet,
 * arrêté sous la semelle de la traverse, la traversait de quarante millimètres.
 */
export function dimensionsPlatineDeFaitage(
  p: ProjectParams,
  profilTraverse: string,
): { largeur: number; hauteur: number; hauteurUtile: number; dessous: number } {
  const ep = p.connections.ridge;
  const h = getProfile(profilTraverse).h;
  const hauteurUtile = p.frame.ridgeHaunch.enabled ? p.frame.ridgeHaunch.depth : getProfile(p.frame.rafterProfile).h;
  const sousJarret = p.frame.ridgeHaunch.enabled ? Math.max(0, p.frame.ridgeHaunch.depth - h) : 0;
  // Le versant le plus raide donne la platine la plus basse.
  const dessous = Math.max(
    ...[leftSlopeRad(p.grid), rightSlopeRad(p.grid)].map(
      (a) => ep.thickness * Math.tan(a) + h / 2 / Math.cos(a) + sousJarret + ep.overhang,
    ),
  );
  const dessus = Math.min(
    ...[leftSlopeRad(p.grid), rightSlopeRad(p.grid)].map((a) => h / 2 / Math.cos(a) - ep.thickness * Math.tan(a)),
  );
  return { largeur: getProfile(profilTraverse).b + 2 * ep.overhang, hauteur: dessus + dessous, hauteurUtile, dessous };
}

export function faitages(p: ProjectParams, members: readonly Member[], plates: Plate[]): void {
  const ep = p.connections.ridge;
  const hauteur = dimensionsPlatineDeFaitage(p, p.frame.rafterProfile).hauteurUtile;
  const pitch = pitchFor(hauteur, ep.rows, ep.edgeDistance);
  const grille = boltGrid(ep.rows, ep.cols, pitch, ep.gauge);
  const trous = grille.map((g) => ({ at: g, d: holeDiameter(ep.bolt) }));

  // Deux platines de faîtage se font face à chaque sommet : on les apparie, pour
  // que la boulonnerie ne soit pas comptée deux fois.
  const auFaitage = members
    .filter((m) => m.role === 'traverse')
    .filter((m) => Math.max(m.start.z, m.end.z) > Math.min(m.start.z, m.end.z));
  const partenaire = new Map<string, string>();
  for (const a of auFaitage) {
    const sommetA = a.end.z > a.start.z ? a.end : a.start;
    for (const b of auFaitage) {
      if (a === b) continue;
      const sommetB = b.end.z > b.start.z ? b.end : b.start;
      if (Math.hypot(sommetA.x - sommetB.x, sommetA.y - sommetB.y, sommetA.z - sommetB.z) < 2) {
        partenaire.set(`${a.id}-PLF`, `${b.id}-PLF`);
      }
    }
  }

  if (p.grid.roofType === 'monopente') return;
  const zFaitage = ridgeHeight(p.grid);
  for (const tr of members.filter((m) => m.role === 'traverse')) {
    const f = memberFrame(tr);
    // Le faîtage est l'about le plus haut de la traverse…
    const auBout = tr.end.z > tr.start.z;
    const sommet = auBout ? tr.end : tr.start;
    /*
     * … à condition d'être AU FAÎTAGE. ⚠ Sur une traverse éclissée, l'about le
     * plus haut du tronçon bas est le joint d'éclisse : il recevait une platine
     * de faîtage boulonnée sur rien — que la boulonnerie comptait, faute de
     * mieux, en tiges d'ancrage.
     */
    if (Math.abs(sommet.z - zFaitage) > 1) continue;

    // ⚠ La platine est soudée sur la FACE DE COUPE, pas perpendiculairement à
    // l'axe : au faîtage la coupe est verticale, la platine l'est donc aussi.
    // C'est le plan de coupe qui donne son orientation, jamais l'axe de la barre.
    const plan = auBout ? tr.cutEnd : tr.cutStart;
    const n = normalize(plan.normal);
    const u = f.ay;
    const v = normalize(cross(u, n));
    const vHaut = v.z >= 0 ? v : scale(v, -1);
    const sens = v.z >= 0 ? 1 : -1;

    /*
     * ⚠ La platine AFFLEURE le dessus de la traverse et ne déborde que vers le
     * bas, comme au genou. Centrée sur l'axe, celle d'un faîtage à jarret
     * dépassait de cent millimètres au-dessus de la semelle : dans les pannes
     * faîtières, et sous la couverture.
     */
    const pr = getProfile(tr.profileId);
    const haut = f.az.z >= 0 ? f.az : scale(f.az, -1);
    // Plan moyen de la platine : entre la face de coupe et le plan du faîtage.
    const o = add(sommet, scale(n, -ep.thickness / 2));
    const surLePlan = (k: number): number => {
      const a = add(tr.start, scale(haut, (k * pr.h) / 2));
      const t = dot(sub(o, a), n) / dot(f.ax, n);
      return dot(sub(add(a, scale(f.ax, t)), o), vHaut);
    };
    const zHaut = surLePlan(1);
    const sousJarret = p.frame.ridgeHaunch.enabled ? Math.max(0, p.frame.ridgeHaunch.depth - pr.h) : 0;
    const zUtile = surLePlan(-1) - sousJarret / Math.max(0.2, vHaut.z);
    const zBas = zUtile - ep.overhang;
    const centre = (zHaut + zBas) / 2;
    // Grille centrée sur la hauteur utile, exprimée dans le repère (u, v) de la tôle.
    const decalage = sens * ((zHaut + zUtile) / 2 - centre);
    const largeur = dimensionsPlatineDeFaitage(p, tr.profileId).largeur;

    plates.push({
      id: `${tr.id}-PLF`,
      kind: 'platine-about',
      grade: tr.grade,
      thickness: ep.thickness,
      outline: rectangle(largeur, zHaut - zBas),
      holes: trous.map((h) => ({ ...h, at: { y: h.at.y, z: h.at.z + decalage } })),
      pairedWith: partenaire.get(`${tr.id}-PLF`) ?? null,
      porteur: tr.id,
      origin: add(o, scale(vHaut, centre)),
      u,
      v,
      mark: '',
      position: `platine de faîtage — ${tr.position}`,
    });
  }
}
