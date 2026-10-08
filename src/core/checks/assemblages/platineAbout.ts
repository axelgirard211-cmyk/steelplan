import { getProfile } from '../../catalog/index';
import type { SteelGradeId } from '../../catalog/types';
import { boltGrid, pitchFor } from '../../geometry/holes';
import { gorgeUsuelle } from '../../geometry/weld';
import { minEdgeDistance, type EndPlateParams } from '../../model/connections';
import { designationBoulon, fbRd, ftRd, fvRd, interactionVT } from '../boulons';
import { tauxCordon } from '../soudures';
import { longueurEfficace, troncon } from './troncon';
import { assembler, verif, type AssemblageCheck, type VerifAssemblage } from './types';

/**
 * PLATINE D'ABOUT BOULONNÉE — genou traverse-poteau, faîtage.
 *
 * ⚠ La géométrie n'est pas redécrite ici : elle est RELUE du même générateur qui
 * dessine la platine et perce le poteau (`pitchFor`, `boltGrid`). Recalculer les
 * positions de boulons à côté aurait laissé le calcul et le plan diverger au
 * premier changement de pince — et c'est le plan qui part en atelier.
 *
 * Le modèle de résistance est celui des rangées : le moment est repris par des
 * rangées de boulons tendues autour d'un centre de compression placé à la fibre
 * extrême comprimée. Chaque rangée est plafonnée par son tronçon en T.
 */

export interface EffortsAssemblage {
  /** Moment fléchissant (N·mm), effort tranchant et effort normal (N). */
  readonly m: number;
  readonly v: number;
  readonly n: number;
  readonly combinaison: string;
}

export interface ContextePlatine {
  readonly id: string;
  readonly libelle: string;
  readonly ep: EndPlateParams;
  /** Hauteur de l'assemblage : celle du jarret s'il y en a un, sinon du profil. */
  readonly hauteurAssemblage: number;
  /** Profil qui reçoit la platine (poteau au genou, traverse au faîtage). */
  readonly profilPorteur: string;
  /** Profil de la barre qui porte la platine soudée. */
  readonly profilBarre: string;
  readonly nuance: SteelGradeId;
}

export function verifierPlatineAbout(
  c: ContextePlatine,
  e: EffortsAssemblage,
): AssemblageCheck {
  const ep = c.ep;
  const porteur = getProfile(c.profilPorteur);
  const barre = getProfile(c.profilBarre);
  const tw = barre.shape === 'I' || barre.shape === 'U' ? barre.tw : barre.h / 10;

  const pas = pitchFor(c.hauteurAssemblage, ep.rows, ep.edgeDistance);
  const grille = boltGrid(ep.rows, ep.cols, pas, ep.gauge);
  const nBoulons = grille.length;
  const verifs: VerifAssemblage[] = [];

  /* ---------------- Géométrie du tronçon en T ---------------- */
  const gorge = gorgeUsuelle(ep.thickness, tw);
  // m : de l'axe du boulon à la face de l'âme, le pied du cordon déduit.
  const m = ep.gauge / 2 - tw / 2 - 0.8 * gorge * Math.SQRT2;
  const largeurPlatine = porteur.b + 2 * ep.overhang;
  const e2 = largeurPlatine / 2 - ep.gauge / 2;

  /* ---------------- Moment résistant par rangées ---------------- */
  /*
   * ⚠ Le centre de compression est pris à la fibre extrême de l'assemblage, du
   * côté opposé aux rangées tendues. C'est l'hypothèse usuelle du calcul
   * simplifié : la semelle comprimée transmet par contact direct, la platine ne
   * travaillant qu'en traction de l'autre côté.
   */
  const zCompression = -c.hauteurAssemblage / 2;
  const rangees = [...new Set(grille.map((g) => g.z))].sort((a, b) => b - a);

  let mRd = 0;
  let ftRdRangeeMax = 0;
  let modeCritique = 'boulons';
  const brasParRangee: { z: number; bras: number; ft: number }[] = [];

  for (const [i, z] of rangees.entries()) {
    const bras = z - zCompression;
    if (bras <= 0) continue;
    // Une rangée d'extrémité dispose de toute la tôle ; une rangée intérieure
    // partage la sienne avec ses voisines.
    const interieure = i > 0 && i < rangees.length - 1;
    const leff = longueurEfficace(m, e2, interieure ? pas : undefined);
    const t = troncon({ leff, tp: ep.thickness, m, e: e2, nBoulons: ep.cols }, ep.bolt, c.nuance);
    mRd += t.ftRd * bras;
    brasParRangee.push({ z, bras, ft: t.ftRd });
    if (t.ftRd > ftRdRangeeMax) {
      ftRdRangeeMax = t.ftRd;
      modeCritique = t.mode;
    }
  }
  verifs.push(verif('moment de l’assemblage', Math.abs(e.m) / 1e6, mRd / 1e6, 'kN·m'));

  /* ---------------- Cisaillement des boulons ---------------- */
  const vParBoulon = Math.abs(e.v) / Math.max(1, nBoulons);
  verifs.push(
    verif('cisaillement des boulons', vParBoulon / 1000, fvRd(ep.bolt) / 1000, 'kN'),
  );

  /* ---------------- Pression diamétrale ---------------- */
  /*
   * ⚠ Sur les DEUX tôles traversées : la platine d'about et la semelle du
   * porteur. C'est la plus mince qui gouverne, et ce n'est pas toujours la
   * platine — une semelle d'IPE 400 fait 13,5 mm quand la platine en fait 20.
   */
  const e1 = Math.max(ep.edgeDistance, minEdgeDistance(ep.bolt));
  for (const [nom, epaisseur] of [
    ['platine d’about', ep.thickness],
    ['semelle du porteur', porteur.shape === 'I' || porteur.shape === 'U' ? porteur.tf : porteur.h],
  ] as const) {
    const rd = fbRd(ep.bolt, epaisseur, c.nuance, { e1, p1: pas, e2, p2: ep.gauge });
    verifs.push(verif(`pression diamétrale — ${nom}`, vParBoulon / 1000, rd / 1000, 'kN'));
  }

  /* ---------------- Interaction cisaillement + traction ---------------- */
  /*
   * La rangée la plus tendue reçoit sa part du moment ET sa part du tranchant.
   * Vérifier les deux séparément laisserait passer l'assemblage où chacun est à
   * 80 % : leur interaction, elle, dépasse 1.
   */
  const rangeeHaute = brasParRangee[0];
  if (rangeeHaute && mRd > 0) {
    // Traction du boulon le plus sollicité : sa part du moment appliqué, plus sa
    // part d'un effort normal de traction s'il y en a un.
    const part = Math.min(1, Math.abs(e.m) / mRd);
    const traction =
      (part * rangeeHaute.ft) / ep.cols + (e.n > 0 ? e.n / Math.max(1, nBoulons) : 0);
    const taux = interactionVT(vParBoulon, traction, ep.bolt);
    verifs.push(verif('interaction cisaillement + traction', taux, 1, '—'));
  }

  /* ---------------- Traction directe des boulons ---------------- */
  if (e.n > 0) {
    // Effort normal de TRACTION : il se répartit sur tous les boulons.
    const tParBoulon = e.n / Math.max(1, nBoulons);
    verifs.push(verif('traction des boulons', tParBoulon / 1000, ftRd(ep.bolt) / 1000, 'kN'));
  }

  /* ---------------- Cordons de la platine ---------------- */
  /*
   * La semelle tendue transmet M/h à la platine par ses cordons ; l'âme
   * transmet le tranchant par les siens.
   */
  const hSemelles = Math.max(1, barre.h - (barre.shape === 'I' ? barre.tf : 0));
  const effortSemelle = Math.abs(e.m) / hSemelles;
  const gorgeSemelle = gorgeUsuelle(ep.thickness, barre.shape === 'I' ? barre.tf : barre.h);
  verifs.push(
    verif(
      `cordon de semelle a${gorgeSemelle}`,
      tauxCordon(effortSemelle, 2 * barre.b, gorgeSemelle, c.nuance),
      1,
      '—',
    ),
  );
  verifs.push(
    verif(
      `cordon d’âme a${gorge}`,
      tauxCordon(Math.abs(e.v), 2 * hSemelles, gorge, c.nuance),
      1,
      '—',
    ),
  );

  return assembler({
    id: c.id,
    libelle: c.libelle,
    boulon: `${ep.rows} × ${ep.cols} ${designationBoulon(ep.bolt)}`,
    sollicitations:
      `M = ${(Math.abs(e.m) / 1e6).toFixed(1)} kN·m · ` +
      `V = ${(Math.abs(e.v) / 1000).toFixed(1)} kN · ` +
      `N = ${(e.n / 1000).toFixed(1)} kN`,
    combinaison: e.combinaison,
    verifs,
    nonCouvert: [
      'panneau d’âme du poteau au cisaillement (EN 1993-1-8 § 6.2.6.1)',
      'flexion de la semelle du poteau et traction de son âme',
      'raidisseurs éventuels, qui augmenteraient la résistance calculée ici',
      `mode de ruine du tronçon en T retenu : ${modeCritique}`,
    ],
  });
}
