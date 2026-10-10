import { buildingLength, leftSlopeRad, ridgeHeight } from '../model/grid';
import type { ProjectParams } from '../model/project';
import { rad2deg } from '../math/tolerance';
import { chargeNeige, type ChargeNeige } from './neige';
import {
  coefficientsParoi,
  coefficientsToiture,
  CPI_NEGATIF,
  CPI_POSITIF,
  pressionDynamique,
  zonageToiture,
  type CoefficientsParoi,
  type CoefficientsToiture,
  type PressionDynamique,
  type ZonageToiture,
} from './vent';
import { cpePannes } from './zonesVent';

export * from './neige';
export * from './vent';

/**
 * CHARGES CLIMATIQUES DÉDUITES DU SITE.
 *
 * ⚠ Jusqu'ici, neige et vent étaient quatre nombres tapés à la main sans qu'on
 * sache d'où ils venaient. Ce module les DÉDUIT de la commune : région de neige,
 * région de vent, catégorie de terrain, altitude. Ce sont quatre données que le
 * projeteur connaît toujours et qui, elles, se vérifient sur une carte.
 *
 * La saisie manuelle reste possible et reste le mode par défaut d'un projet
 * ancien : un fichier enregistré avant ce module n'a pas de site, et ses charges
 * ne doivent pas changer sous lui.
 */

export interface ChargesClimatiques {
  readonly neige: ChargeNeige;
  readonly vent: PressionDynamique;
  readonly paroi: CoefficientsParoi;
  readonly toiture: CoefficientsToiture;
  readonly zonage: ZonageToiture;
  /** Succion de la bande de rive G, celle des pannes. */
  readonly cpePannes: number;
  /**
   * Ce qui alimente le modèle de charges, en kN/m². Les portiques reçoivent le
   * vent zone par zone ; ces deux valeurs enveloppes servent à l'ossature
   * secondaire, et à l'affichage.
   */
  readonly valeurs: {
    readonly neige: number;
    readonly neigeAccidentelle: number;
    readonly ventPression: number;
    readonly ventDepression: number;
  };
}

export function chargesClimatiques(p: ProjectParams): ChargesClimatiques {
  const g = p.grid;
  const site = p.site;
  const penteDeg = rad2deg(leftSlopeRad(g));

  const neige = chargeNeige(site.zoneNeige, site.altitude, penteDeg);

  /*
   * ⚠ La hauteur de référence est celle du FAÎTAGE, pas de l'égout. C'est la
   * cote la plus haute du bâtiment, donc celle où le vent est le plus fort, et
   * l'EN 1991-1-4 § 7.2.2 impose de la retenir pour un bâtiment dont la hauteur
   * ne dépasse pas la largeur. Prendre l'égout sous-estimerait la pression de la
   * hauteur du pignon.
   */
  const vent = pressionDynamique(site.zoneVent, site.terrain, ridgeHeight(g) / 1000);

  /*
   * h/d : hauteur du bâtiment sur sa dimension DANS LE SENS DU VENT. Le vent
   * transversal, celui qui dimensionne le portique, traverse la portée.
   */
  const h = ridgeHeight(g) / 1000;
  const paroi = coefficientsParoi(h, g.span / 1000);
  const toiture = coefficientsToiture(penteDeg);
  // Vent transversal : il traverse la PORTÉE, la longueur du bâtiment lui est
  // perpendiculaire.
  const zonage = zonageToiture(toiture, buildingLength(g) / 1000, g.span / 1000, h);
  const pannes = cpePannes(g);

  return {
    neige,
    vent,
    paroi,
    toiture,
    zonage,
    cpePannes: pannes,
    valeurs: {
      neige: arrondi(neige.s),
      neigeAccidentelle: arrondi(neige.sAccidentelle),
      /*
       * ⚠ La pression INTÉRIEURE entre dans les deux valeurs, avec le signe le
       * plus défavorable pour chacune. Sur la paroi au vent c'est la dépression
       * intérieure qui aggrave, sur la toiture aspirée c'est la surpression.
       * L'omettre — ce que faisait la saisie manuelle — sous-estime l'enveloppe
       * de 20 à 30 %.
       */
      ventPression: arrondi(vent.qp * (paroi.D - CPI_NEGATIF)),
      /*
       * ⚠ La succion de la bande de rive G, pas la moyenne de la toiture. La
       * moyenne vaut pour une résultante — c'est pourquoi les portiques
       * reçoivent désormais chaque zone pour sa part —, mais une panne ne
       * reçoit que la bande où elle se trouve, et la panne sablière court
       * toute sa portée dans G. Toutes les pannes ont son profil. Les angles
       * F restent l'affaire de la fixation du bac.
       */
      ventDepression: arrondi(Math.abs(vent.qp * (pannes - CPI_POSITIF))),
    },
  };
}

/** Deux décimales : au-delà, on afficherait une précision qu'on n'a pas. */
const arrondi = (v: number): number => Math.round(v * 100) / 100;

/**
 * Charges effectivement employées par le calcul.
 *
 * En mode `eurocode` elles viennent du site ; en mode `manuel` elles restent
 * celles que l'utilisateur a saisies. Le poids propre et l'exploitation ne
 * dépendent pas du climat et ne sont jamais recalculés.
 */
export function chargesEffectives(p: ProjectParams): ProjectParams['loads']['loads'] {
  if (p.site.mode === 'manuel') return p.loads.loads;
  const c = chargesClimatiques(p).valeurs;
  return { ...p.loads.loads, ...c };
}

/**
 * Modèle de charges effectif, site compris.
 *
 * ⚠ UN SEUL point d'entrée. Les combinaisons et les intensités doivent voir les
 * mêmes valeurs : les alimenter séparément, c'est se donner l'occasion de
 * combiner une neige et d'en appliquer une autre.
 */
export function modeleDeCharges(p: ProjectParams): ProjectParams['loads'] {
  return { ...p.loads, loads: chargesEffectives(p) };
}

/** Lignes d'hypothèses décrivant le climat retenu, pour le rapport. */
export function hypothesesClimat(p: ProjectParams): string[] {
  // La dissymétrie ne dépend que de la forme de la toiture : elle vaut aussi
  // pour une neige saisie.
  const repartition =
    p.grid.roofType === 'bipente'
      ? ['Neige répartie uniformément, puis réduite de moitié sur un versant et sur l’autre (EN 1991-1-3 § 5.3.3, figure 5.3).']
      : [];
  if (p.site.mode === 'manuel') {
    return [
      'Neige et vent SAISIS À LA MAIN : le logiciel ne les a ni calculés ni vérifiés. ' +
        'Basculer le site en mode Eurocode les déduit de la région et de l’altitude, et applique le vent par zones.',
      ...repartition,
    ];
  }

  const c = chargesClimatiques(p);
  const n = c.neige;
  const v = c.vent;
  const z = (x: readonly [number, number]): string =>
    `${x[0].toFixed(2)} / ${x[1].toFixed(2)}`;

  const out = [
    `Neige EN 1991-1-3 : région ${n.sol.zone} à ${n.sol.altitude} m ⇒ sk = ${n.sol.sk.toFixed(2)} kN/m², ` +
      `µ1 = ${n.mu1.toFixed(2)} ⇒ s = ${n.s.toFixed(2)} kN/m².`,
    ...repartition,
    `Vent EN 1991-1-4 : région ${p.site.zoneVent}, terrain ${p.site.terrain}, ze = ${v.ze.toFixed(1)} m ⇒ ` +
      `vb = ${v.vb.toFixed(0)} m/s, vm = ${v.vm.toFixed(1)} m/s, qp = ${v.qp.toFixed(3)} kN/m².`,
    `Coefficients de paroi : D = ${c.paroi.D.toFixed(2)} (au vent), E = ${c.paroi.E.toFixed(2)} (sous le vent), ` +
      `A ${c.paroi.A.toFixed(1)} · B ${c.paroi.B.toFixed(1)} · C ${c.paroi.C.toFixed(1)} (parois parallèles au vent).`,
    `Coefficients de toiture, vent de travers (négatif / positif) : F ${z(c.toiture.F)} · G ${z(c.toiture.G)} · ` +
      `H ${z(c.toiture.H)} · I ${z(c.toiture.I)} · J ${z(c.toiture.J)}.`,
    'Portiques : vent PAR ZONES, en huit cas — de travers dans les deux sens, versant au vent aspiré ' +
      `(cpi +${CPI_POSITIF.toFixed(1)} puis ${CPI_NEGATIF.toFixed(1)}) ou poussé (cpi ${CPI_NEGATIF.toFixed(1)}), ` +
      `puis sur pignon (cpi +${CPI_POSITIF.toFixed(1)} puis ${CPI_NEGATIF.toFixed(1)}). Chaque paroi reçoit qp × (cpe − cpi) ` +
      'de sa zone : D et E sur les long-pans, F à J en toiture, A à C et F à I sous vent de pignon. Le portique ' +
      'courant reçoit la bande de la première file intérieure, la plus exposée.',
    `Pannes : succion de la bande de rive G, cpe = ${c.cpePannes.toFixed(2)}, augmentée de cpi = +${CPI_POSITIF.toFixed(2)} ; ` +
      `lisses et potelets : pression D, augmentée de cpi = ${CPI_NEGATIF.toFixed(2)}. La pointe des angles F ` +
      `(${c.zonage.cpePointe.toFixed(2)}) dimensionne la fixation du bac, que SteelPlan ne vérifie pas.`,
    'Coefficients cpe,10 RECOMMANDÉS par l’EN 1991-1-4 (tableaux 7.1, 7.3a-b, 7.4a-b). L’annexe nationale ' +
      'française remplace le tableau 7.4a : ses valeurs ne sont pas appliquées ici et sont à contrôler.',
    `Pression intérieure prise à +${CPI_POSITIF.toFixed(2)} et à ${CPI_NEGATIF.toFixed(2)} (EN 1991-1-4 § 7.2.9), ` +
      'bâtiment sans face dominante.',
    'Vent sur pignon : la pression sur le pignon lui-même descend par les potelets et la poutre au vent, ' +
      'calculés par le cheminement simplifié des contreventements.',
  ];
  if (n.sAccidentelle > 0) {
    out.push(
      `Région ${n.sol.zone} : charge de neige ACCIDENTELLE sAd = ${n.sol.sAd.toFixed(2)} kN/m² au sol, ` +
        `soit ${n.sAccidentelle.toFixed(2)} kN/m² en toiture, vérifiée sous combinaison accidentelle.`,
    );
  }
  return out;
}
