import { getProfile } from '../../catalog/index';
import { hole, type Hole } from '../../geometry/holes';
import { memberFrame, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { add, dot, normalize, scale, sub, v3, EZ, type Vec3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance, tigeDAncrage } from '../../model/connections';
import { buildingLength } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import type { Plate } from '../types';
import { rectangle } from './geom';
import { EPAISSEUR_PIED_POTELET } from './platines';

/**
 * ATTACHES DES CHEVÊTRES D'OUVERTURE.
 *
 * ⚠ Montants, linteau et traverse basse étaient posés dans le plan des lisses
 * sans rien qui les tienne : ni pied, ni boulon, ni soudure. Le monteur recevait
 * un portail encadré de barres libres.
 *
 * Détail retenu, celui des ossatures de bardage :
 *  - le MONTANT repose sur une platine de pied à deux tiges d'ancrage, comme un
 *    potelet — même gabarit de scellement ;
 *  - chaque about de lisse, de linteau ou de traverse basse qui arrive sur un
 *    montant se boulonne sur un PLAT soudé en atelier contre la semelle
 *    intérieure du montant, côté bâtiment, à fleur des semelles intérieures ;
 *  - la tête du montant, arrêtée sous la lisse continue qui la tient, s'y
 *    boulonne par un plat de même nature.
 * Les plats ne demandent aucun perçage du montant : tout l'atelier est soudé, tout
 * le chantier est boulonné.
 */

/** Jeu entre une tôle et ce qu'elle longe (mm). */
const JEU = 10;
/** Recouvrement du plat de tête sur le montant, pour ses cordons (mm). */
const RECOUVREMENT = 60;

interface Facade {
  /** Normale au plan de façade, tournée vers l'intérieur du bâtiment. */
  readonly interieur: Vec3;
}

export function attachesDeChevetres(
  p: ProjectParams,
  members: readonly Member[],
  plates: Plate[],
  ajouter: (memberId: string, h: Hole[]) => void,
): void {
  const montants = members.filter((m) => m.role === 'chevetre' && Math.abs(memberFrame(m).ax.z) > 0.99);
  if (montants.length === 0) return;
  const horizontales = members.filter(
    (m) => (m.role === 'lisse' || m.role === 'chevetre') && Math.abs(memberFrame(m).ax.z) < 0.01,
  );
  const centre = v3(buildingLength(p.grid) / 2, p.grid.span / 2, 0);
  const bolt = p.connections.secondaryBolt;
  const d0 = holeDiameter(bolt);
  const pince = Math.max(2 * d0, minEdgeDistance(bolt));
  const entraxe = 3 * d0;
  const t = p.connections.gusset.thickness;

  for (const mo of montants) {
    const f = memberFrame(mo);
    const signe = Math.sign(dot(sub(centre, mo.start), f.az)) || 1;
    const facade: Facade = { interieur: scale(f.az, signe) };
    const ext = etendue(mo.profileId);
    const faceInterieure = signe > 0 ? ext.zMax : -ext.zMin;

    plates.push(piedDeMontant(p, mo));

    // Abouts de lisses, de linteau et de traverse basse arrivant sur ce montant.
    const arrivees = new Map<number, Arrivee[]>();
    for (const h of horizontales) {
      if (Math.abs(dot(sub(h.start, mo.start), facade.interieur)) > 1) continue;
      for (const bout of ['start', 'end'] as const) {
        const e = bout === 'start' ? h.start : h.end;
        if (e.z < mo.start.z || e.z > mo.end.z) continue;
        const le = dot(sub(e, mo.start), f.ay);
        if (Math.abs(le) > Math.max(-ext.yMin, ext.yMax) + JEU + 15) continue;
        const cle = Math.round(e.z);
        arrivees.set(cle, [...(arrivees.get(cle) ?? []), { h, bout, cote: le >= 0 ? 1 : -1 }]);
      }
    }
    /*
     * ⚠ Une lisse coupée autour du montant y arrive DES DEUX CÔTÉS à la même
     * hauteur : deux plats auraient occupé la même semelle. Un seul plat de
     * continuité les reçoit toutes deux.
     */
    let hautDesPlats = -Infinity;
    for (const groupe of arrivees.values()) {
      const pl = platLateral(mo, groupe.slice(0, 2), facade, faceInterieure, { pince, entraxe, d0, t, bolt });
      if (!pl) continue;
      plates.push(pl.plat);
      for (const [id, trous] of pl.trous) ajouter(id, trous);
      hautDesPlats = Math.max(hautDesPlats, pl.plat.origin.z + Math.max(...pl.plat.outline.map((q) => q.z)));
    }

    // Tête : la lisse continue juste au-dessus, qui passe au droit du montant.
    const tete = mo.end.z;
    for (const r of horizontales.filter((x) => x.role === 'lisse')) {
      if (Math.abs(dot(sub(r.start, mo.start), facade.interieur)) > 1) continue;
      const fr = memberFrame(r);
      const er = etendue(r.profileId);
      const vert = (y: number): number => r.start.z + fr.ay.z * y;
      const bas = Math.min(vert(er.yMin), vert(er.yMax));
      // Au-dessus de la tête, au jeu près — un U de pignon est retourné : sa rive
      // basse n'est pas toujours sa plus grande demi-largeur.
      if (bas < tete + JEU - 2 || bas > tete + JEU + 40) continue;
      const s = dot(sub(mo.start, r.start), fr.ax);
      const l = Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y);
      if (s < 0 || s > l) continue;
      // Le plat de tête s'arrête au-dessus des plats latéraux : un linteau juste
      // sous la tête du montant a le sien à quelques centimètres.
      const pied = Math.max(mo.end.z - RECOUVREMENT, hautDesPlats + 5);
      const pl = platDeTete(mo, r, pied, facade, faceInterieure, { pince, entraxe, d0, t, bolt });
      plates.push(pl.plat);
      ajouter(r.id, pl.trous);
      break;
    }
  }
}

/** Étendue d'une section dans son repère (mm). */
function etendue(profil: string): { yMin: number; yMax: number; zMin: number; zMax: number } {
  const o = sectionOutline(getProfile(profil), 1).outer;
  return {
    yMin: Math.min(...o.map((q) => q.y)),
    yMax: Math.max(...o.map((q) => q.y)),
    zMin: Math.min(...o.map((q) => q.z)),
    zMax: Math.max(...o.map((q) => q.z)),
  };
}

/** Milieu de la semelle intérieure d'un U, dans sa section : là où passe le boulon. */
function aileInterieure(m: Member, facade: Facade): { y: number; z: number } {
  const pr = getProfile(m.profileId);
  const f = memberFrame(m);
  const s = Math.sign(dot(f.az, facade.interieur)) || 1;
  const yAile = pr.shape === 'U' ? pr.b / 2 - pr.cy : 0;
  return { y: yAile, z: (s * pr.h) / 2 };
}

/** Un about de pièce horizontale qui arrive sur le montant. */
interface Arrivee {
  readonly h: Member;
  readonly bout: 'start' | 'end';
  /** Côté du montant, selon son axe y. */
  readonly cote: 1 | -1;
}

function platLateral(
  mo: Member,
  arrivees: readonly Arrivee[],
  facade: Facade,
  faceInterieure: number,
  c: { pince: number; entraxe: number; d0: number; t: number; bolt: ProjectParams['connections']['secondaryBolt'] },
): { plat: Plate; trous: Map<string, Hole[]> } | null {
  const f = memberFrame(mo);
  const ext = etendue(mo.profileId);
  const premiere = arrivees[0] as Arrivee;
  const eh = etendue(premiere.h.profileId);
  const fh0 = memberFrame(premiere.h);
  const e0 = premiere.bout === 'start' ? premiere.h.start : premiere.h.end;
  // Un seul côté : le plat part de la rive opposée de la semelle du montant.
  const u = scale(f.ay, arrivees.length === 1 ? premiere.cote : 1);
  let uMin = arrivees.length === 1 ? (premiere.cote > 0 ? ext.yMin : -ext.yMax) : Infinity;
  let uMax = -Infinity;
  const id =
    arrivees.length === 1
      ? `${premiere.h.id}-AL${premiere.bout === 'start' ? 0 : 1}`
      : `${mo.id}-ALC${Math.round(e0.z)}`;
  const trous = new Map<string, Hole[]>();
  const boulonsDuPlat: { u: number; z: number }[] = [];
  for (const a of arrivees) {
    const fh = memberFrame(a.h);
    const e = a.bout === 'start' ? a.h.start : a.h.end;
    const l = Math.hypot(a.h.end.x - a.h.start.x, a.h.end.y - a.h.start.y);
    const sens = dot(u, f.ay) * a.cote; // +1 si la pièce est du côté des u croissants
    const uE = dot(sub(e, mo.start), u);
    const us = [uE + sens * c.pince, uE + sens * (c.pince + c.entraxe)];
    if (l < c.pince + c.entraxe + c.pince + 10) return null;
    for (const ub of us) {
      uMin = Math.min(uMin, ub - c.pince);
      uMax = Math.max(uMax, ub + c.pince);
    }
    const aile = aileInterieure(a.h, facade);
    const zBoulon = e.z + fh.ay.z * aile.y;
    const versInterieur = a.bout === 'start' ? 1 : -1;
    trous.set(
      a.h.id,
      us.map((ub) => hole((a.bout === 'start' ? 0 : l) + versInterieur * Math.abs(ub - uE), aile, c.bolt, 'z', 'aile', id)),
    );
    for (const ub of us) boulonsDuPlat.push({ u: ub, z: zBoulon });
  }
  // Hauteur : celle de la semelle de la pièce, entre ses rives.
  const zs = [eh.yMin, eh.yMax].map((y) => e0.z + fh0.ay.z * y);
  const zBas = Math.min(...zs);
  const zHaut = Math.max(...zs);
  const uMil = (uMin + uMax) / 2;
  const zMil = (zBas + zHaut) / 2;
  const plan = add(v3(mo.start.x, mo.start.y, 0), scale(facade.interieur, faceInterieure + c.t / 2));
  const premierRole = premiere.h.role === 'lisse' ? 'lisse' : 'chevêtre';
  return {
    plat: {
      id,
      kind: 'attache-lisse',
      grade: mo.grade,
      thickness: c.t,
      outline: rectangle(Math.ceil((uMax - uMin) / 5) * 5, zHaut - zBas),
      holes: boulonsDuPlat.map((b) => ({ at: { y: b.u - uMil, z: b.z - zMil }, d: c.d0 })),
      pairedWith: null,
      porteur: mo.id,
      origin: add(add(plan, scale(u, uMil)), scale(EZ, zMil)),
      u,
      v: EZ,
      mark: '',
      position:
        arrivees.length > 1
          ? `plat de continuité de ${premierRole}, soudé sur le montant — ${mo.position}`
          : `plat d’attache de ${premierRole}, soudé sur le montant — ${mo.position}`,
    },
    trous,
  };
}

function platDeTete(
  mo: Member,
  r: Member,
  zBas: number,
  facade: Facade,
  faceInterieure: number,
  c: { pince: number; entraxe: number; d0: number; t: number; bolt: ProjectParams['connections']['secondaryBolt'] },
): { plat: Plate; trous: Hole[] } {
  const f = memberFrame(mo);
  const fr = memberFrame(r);
  const ext = etendue(mo.profileId);
  const er = etendue(r.profileId);
  // Centré sur la semelle du montant, assez large pour deux boulons côte à côte.
  const milieu = (ext.yMin + ext.yMax) / 2;
  const largeur = Math.ceil(Math.max(ext.yMax - ext.yMin, c.entraxe + 2 * c.pince) / 10) * 10;
  const zs = [er.yMin, er.yMax].map((y) => r.start.z + fr.ay.z * y);
  const zHaut = Math.max(...zs);
  const aile = aileInterieure(r, facade);
  const zBoulon = r.start.z + fr.ay.z * aile.y;
  const plan = add(v3(mo.start.x, mo.start.y, 0), scale(facade.interieur, faceInterieure + c.t / 2));
  const origine = add(add(plan, scale(f.ay, milieu)), scale(EZ, (zBas + zHaut) / 2));
  const id = `${mo.id}-ALT`;
  const sCentre = dot(sub(add(mo.start, scale(f.ay, milieu)), r.start), fr.ax);
  const signe = Math.sign(dot(fr.ax, f.ay)) || 1;
  const decalages = [-c.entraxe / 2, c.entraxe / 2];
  return {
    plat: {
      id,
      kind: 'attache-lisse',
      grade: mo.grade,
      thickness: c.t,
      outline: rectangle(largeur, zHaut - zBas),
      holes: decalages.map((dy) => ({ at: { y: dy, z: zBoulon - (zBas + zHaut) / 2 }, d: c.d0 })),
      pairedWith: null,
      porteur: mo.id,
      origin: origine,
      u: f.ay,
      v: EZ,
      mark: '',
      position: `plat de tête de montant, soudé sur le montant, boulonné sur la lisse — ${mo.position}`,
    },
    trous: decalages.map((dy) => hole(sCentre + signe * dy, aile, c.bolt, 'z', 'aile', id)),
  };
}

/**
 * Platine de pied d'un montant : deux tiges d'ancrage de part et d'autre de la
 * section, le long de la façade, du diamètre des tiges de poteaux.
 */
function piedDeMontant(p: ProjectParams, mo: Member): Plate {
  const f = memberFrame(mo);
  const ext = etendue(mo.profileId);
  const { bolt, dTrou } = tigeDAncrage(p.connections.columnBase);
  const pince = Math.max(1.5 * dTrou, minEdgeDistance(bolt));
  const ecart = Math.max(-ext.yMin, ext.yMax) + 1.25 * bolt.d + 5;
  const arrondi = (v: number): number => Math.ceil(v / 10) * 10;
  const ep = EPAISSEUR_PIED_POTELET;
  return {
    id: `${mo.id}-PLP`,
    kind: 'platine-pied',
    grade: mo.grade,
    thickness: ep,
    outline: rectangle(arrondi(2 * (ecart + pince)), arrondi(ext.zMax - ext.zMin + 30)),
    holes: [-1, 1].map((sy) => ({ at: { y: sy * ecart, z: 0 }, d: dTrou })),
    pairedWith: null,
    porteur: mo.id,
    origin: add(mo.start, scale(f.ax, -ep / 2)),
    u: f.ay,
    v: f.az,
    mark: '',
    position: `pied de montant de chevêtre — ${mo.position}`,
  };
}

/**
 * Cordons d'un plat d'attache sur son montant : le long des bords de la zone où
 * il recouvre la semelle — ses bords haut et bas pour un plat d'about de lisse,
 * les rives de la semelle pour un plat de tête.
 */
export function cordonsDAttache(
  pl: Plate,
  mo: Member,
): { longueur: number; aretes: { a: Vec3; b: Vec3; dehors: Vec3 }[] } {
  const f = memberFrame(mo);
  const ext = etendue(mo.profileId);
  const u = normalize(pl.u);
  const ys = pl.outline.map((q) => q.y);
  const zs = pl.outline.map((q) => q.z);
  // Semelle du montant dans le repère du plat.
  const centre = dot(sub(add(mo.start, scale(f.ay, 0)), pl.origin), u);
  const k = dot(f.ay, u);
  const [a, b] = [centre + k * ext.yMin, centre + k * ext.yMax].sort((x, y) => x - y) as [number, number];
  const y0 = Math.max(Math.min(...ys), a);
  const y1 = Math.min(Math.max(...ys), b);
  const zMoBas = mo.start.z - pl.origin.z;
  const zMoHaut = mo.end.z - pl.origin.z;
  const z0 = Math.max(Math.min(...zs), zMoBas);
  const z1 = Math.min(Math.max(...zs), zMoHaut);
  // Face arrière du plat : celle qui est plaquée sur la semelle du montant.
  const n = crossDir(pl);
  const dos = scale(n, (Math.sign(dot(n, sub(mo.start, pl.origin))) || 1) * (pl.thickness / 2));
  const point = (y: number, z: number): Vec3 => add(add(add(pl.origin, scale(u, y)), scale(EZ, z)), dos);
  if (z0 <= Math.min(...zs) + 0.5 && z1 >= Math.max(...zs) - 0.5) {
    // Plat entièrement dans la hauteur du montant : ses bords haut et bas.
    return {
      longueur: y1 - y0,
      aretes: [
        { a: point(y0, z1), b: point(y1, z1), dehors: EZ },
        { a: point(y0, z0), b: point(y1, z0), dehors: scale(EZ, -1) },
      ],
    };
  }
  return {
    longueur: z1 - z0,
    aretes: [
      { a: point(a, z0), b: point(a, z1), dehors: scale(u, -1) },
      { a: point(b, z0), b: point(b, z1), dehors: u },
    ],
  };
}

/** Normale du plat, u × v. */
function crossDir(pl: Plate): Vec3 {
  const u = normalize(pl.u);
  const v = normalize(pl.v);
  return v3(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
}
