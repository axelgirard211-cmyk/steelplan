import { getProfile } from '../../catalog/index';
import { fibreAbscissa, memberFrame, type Member } from '../../geometry/member';
import { cross, dot, normalize, scale, sub, type Vec3 } from '../../math/vec3';
import { holeDiameter, minEdgeDistance } from '../../model/connections';
import type { ProjectParams } from '../../model/project';
import { longueurDeFente, type Disposition } from './contreventement';
import { trusquinage } from './eclisses';

/**
 * POUTRE AU VENT SUR FERMES EN CORNIÈRES DOUBLES.
 *
 * ⚠ Sur une ferme, les tubes ne s'attachaient à rien : faute d'âme où souder un
 * gousset, ils s'arrêtaient sous l'arbalétrier, dans le treillis, leurs abouts
 * plantés dans les diagonales.
 *
 * Les deux brins d'une croix se croisent au milieu de la travée : ils doivent
 * passer l'un au-dessus de l'autre, d'un diamètre au moins. L'arbalétrier en
 * offre deux niveaux, de part et d'autre de son aile couchée :
 *  - DESSUS : un gousset soudé contre la face intérieure de la grande aile,
 *    au-dessus du congé et sous les écrous des boulons membrure–gousset ; le plat
 *    du tube se boulonne dessus ;
 *  - DESSOUS : une tôle boulonnée sous l'aile couchée, d'épaisseur suffisante pour
 *    que le second tube passe sous le premier ; le plat se boulonne dessous.
 * Le treillis s'arrête plus bas sous l'arbalétrier pour laisser cette tôle et ses
 * écrous (voir l'ébout dans `buildTruss`).
 *
 * Les cotes se comptent selon la normale au versant depuis l'axe de la cornière.
 */

export interface NiveauxSurFerme {
  /** Axe du brin posé au-dessus de l'aile couchée (mm). */
  readonly dessus: number;
  /** Axe du brin posé sous l'aile couchée (mm), s'il y en a un. */
  readonly dessous: number | null;
  /** Épaisseur de la tôle boulonnée sous l'aile couchée (mm). */
  readonly epaisseurDessous: number;
}

/** Jeu entre une tôle et ce qu'elle longe sans y être fixée (mm). */
const JEU = 10;

export function niveauxSurFerme(p: ProjectParams): NiveauxSurFerme | null {
  if (!p.truss.enabled || !p.truss.doubleAngles || !p.bracing.roof.enabled) return null;
  const pr = getProfile(p.truss.topChordProfile);
  if (pr.shape !== 'L') return null;
  const t = p.connections.gusset.thickness;
  const bolt = p.connections.gusset.bolt;
  const D = getProfile(p.bracing.roof.profile).h;
  const cle = (0.75 * bolt.d) / Math.cos(Math.PI / 6);

  // Bande libre contre la grande aile : du congé aux écrous membrure–gousset.
  const bas = -pr.cz + pr.t + pr.r;
  const haut = -pr.cz + trusquinage(pr, bolt) - cle - 2;
  if (haut - bas < t) return null;
  const dessus = bas + 1.5 * t;
  // Le tube reste sous le dessus de la membrure, où reposent les pannes.
  if (dessus + D / 2 > pr.a - pr.cz - 5) return null;
  if (p.bracing.roof.shape !== 'croix') return { dessus, dessous: null, epaisseurDessous: t };

  const voulu = dessus - D - JEU;
  const epaisseur = Math.max(t, Math.ceil((-pr.cz - t / 2 - voulu) / 5) * 5);
  if (epaisseur > 40) return null;
  return { dessus, dessous: -pr.cz - epaisseur - t / 2, epaisseurDessous: epaisseur };
}

/**
 * Hauteur réservée sous l'aile couchée de l'arbalétrier : la tôle d'attache et
 * ses écrous, plus le jeu ordinaire. Zéro sans poutre au vent sous l'aile.
 */
export function reserveSousArbaletrier(p: ProjectParams): number {
  const n = niveauxSurFerme(p);
  if (!n || n.dessous === null) return 0;
  return n.epaisseurDessous + 0.8 * p.connections.gusset.bolt.d + 3;
}

/**
 * Disposition d'une attache sur la cornière d'arbalétrier du côté du tube, ou
 * `null` si elle ne peut pas la recevoir.
 *
 * @param travail point de l'AXE de la cornière au droit du nœud
 */
export function dispositionSurCorniere(
  p: ProjectParams,
  appui: Member,
  travail: Vec3,
  a: Vec3,
  n: Vec3,
  decalage: number,
  diametreTube: number,
): Disposition | null {
  const pr = getProfile(appui.profileId);
  const niveaux = niveauxSurFerme(p);
  if (pr.shape !== 'L' || !niveaux) return null;
  const f = memberFrame(appui);
  if (Math.abs(dot(n, f.az)) < 0.999) return null;
  const e1 = f.ax;
  let e2 = normalize(cross(n, e1));
  if (dot(a, e2) < 0) e2 = scale(e2, -1);
  // La cornière du côté du tube : son aile couchée s'étend vers lui.
  if (dot(e2, f.ay) < 0.9) return null;
  const c1 = dot(a, e1);
  const c2 = dot(a, e2);
  if (c2 < 0.2 || Math.abs(dot(a, n)) > 1e-6) return null;

  const t = p.connections.gusset.thickness;
  const bolt = p.connections.gusset.bolt;
  const d0 = holeDiameter(bolt);
  const pince = Math.max(1.5 * d0, minEdgeDistance(bolt));
  const entraxe = 3 * d0;
  const largeurPlat = Math.ceil((diametreTube + 20) / 10) * 10;
  const dessous = decalage < -pr.cz;

  // Cotes selon e2 depuis l'axe de la cornière : la grande aile a son dos en −cy.
  const face = dessous ? 2 - pr.cy : pr.t - pr.cy;
  const obstacle = pr.a2 - pr.cy;
  // Le tube passe aussi à hauteur du treillis : il dégage les ailes des barres.
  const ailes = [p.truss.diagonalProfile, p.truss.postProfile].map((id) => {
    const w = getProfile(id);
    return w.shape === 'L' ? w.a : w.h / 2;
  });
  const encombrement = Math.max(obstacle, ...ailes.map((x) => x - pr.cy));

  const sTravail = dot(sub(travail, appui.start), e1);
  const axe = { y: 0, z: 0 };
  const s0 = fibreAbscissa(f, appui.start, appui.cutStart, axe);
  const s1 = fibreAbscissa(f, appui.start, appui.cutEnd, axe);
  const haut = Math.max(s0, s1) - sTravail - JEU;
  const bas = Math.min(s0, s1) - sTravail + JEU;

  const demiPlat = largeurPlat / 2;
  const mini = [0, (obstacle + 2 * d0) / c2, (face + 5 + demiPlat * Math.abs(c1)) / c2 + pince];
  const maxi: number[] = [];
  if (Math.abs(c1) > 1e-6) {
    const vers = c1 > 0 ? haut : bas;
    const depuis = c1 > 0 ? bas : haut;
    const signe = Math.sign(c1);
    mini.push((depuis + signe * pince) / c1);
    mini.push(pince + (depuis + signe * demiPlat * c2) / c1);
    maxi.push((vers - signe * pince) / c1 - entraxe);
  }
  const lambda1 = arrondi5(Math.max(...mini));
  if (maxi.some((m) => lambda1 > m + 1e-6)) return null;
  const lambda2 = lambda1 + entraxe;
  const about = arrondi5(
    Math.max(lambda2 + Math.max(1.1 * pince + 5, 0.9 * bolt.d + 10), (encombrement + 5 + (diametreTube / 2) * Math.abs(c1)) / c2),
  );
  const epaisseurGousset = dessous ? niveaux.epaisseurDessous : t;
  // Sous l'aile couchée, la tôle se boulonne sur elle, sur sa ligne de trusquinage.
  const g2 = trusquinage({ a: pr.a2, t: pr.t, r: pr.r }, bolt) - pr.cy;
  // Centrés sur le nœud ; au faîtage, où l'arbalétrier s'arrête, ramenés dans son métal.
  let ys = [-entraxe / 2, entraxe / 2];
  if ((ys[1] as number) > haut - pince) ys = [haut - pince - entraxe, haut - pince];
  if ((ys[0] as number) < bas + pince) ys = [bas + pince, bas + pince + entraxe];
  if (dessous && ys.some((y) => y < bas + pince - 1e-6 || y > haut - pince + 1e-6)) return null;
  const boulonsDAppui = dessous ? ys.map((y) => ({ y, z: g2 - face })) : [];

  return {
    appui: appui.id,
    type: dessous ? 'sous-aile' : 'aile',
    travail,
    a,
    n,
    e1,
    e2,
    decalage,
    gousset: dessous ? -pr.cz - epaisseurGousset / 2 : decalage - (t + epaisseurGousset) / 2,
    face,
    boulons: [lambda1, lambda2],
    about,
    fond: about + longueurDeFente(diametreTube),
    bout: lambda1 - pince,
    largeurPlat,
    epaisseur: t,
    epaisseurGousset,
    boulonsDAppui,
    ligneDAppui: { y: -pr.cy + trusquinage({ a: pr.a2, t: pr.t, r: pr.r }, bolt), z: -pr.cz + pr.t / 2, s: sTravail },
    bolt,
    limites: [bas, haut],
  };
}

function arrondi5(v: number): number {
  return Math.ceil(v / 5 - 1e-9) * 5;
}
