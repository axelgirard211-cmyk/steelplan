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
  /** Ce qui alimente le modèle de charges, en kN/m². */
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

  return {
    neige,
    vent,
    paroi,
    toiture,
    zonage,
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
       * ⚠ Le coefficient MOYEN pondéré par les aires, et non celui de rive. La
       * zone F ne couvre qu'une bande de e/10 aux deux angles au vent : sur ce
       * hangar, dix mètres carrés sur six cents. L'appliquer partout triplait le
       * soulèvement d'ensemble et condamnait des bâtiments corrects. La pointe de
       * rive reste exposée pour la fixation du bac, où elle est la bonne valeur.
       */
      ventDepression: arrondi(Math.abs(vent.qp * (zonage.cpeMoyen - CPI_POSITIF))),
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
  if (p.site.mode === 'manuel') {
    return [
      'Neige et vent SAISIS À LA MAIN : le logiciel ne les a ni calculés ni vérifiés. ' +
        'Basculer le site en mode Eurocode les déduit de la région et de l’altitude.',
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
    `Vent EN 1991-1-4 : région ${p.site.zoneVent}, terrain ${p.site.terrain}, ze = ${v.ze.toFixed(1)} m ⇒ ` +
      `vb = ${v.vb.toFixed(0)} m/s, vm = ${v.vm.toFixed(1)} m/s, qp = ${v.qp.toFixed(3)} kN/m².`,
    `Coefficients de paroi : D = ${c.paroi.D.toFixed(2)} (au vent), E = ${c.paroi.E.toFixed(2)} (sous le vent).`,
    `Coefficients de toiture (négatif / positif) : F ${z(c.toiture.F)} · G ${z(c.toiture.G)} · ` +
      `H ${z(c.toiture.H)} · I ${z(c.toiture.I)} · J ${z(c.toiture.J)}.`,
    `Zonage EN 1991-1-4 figure 7.8 : e = ${c.zonage.e.toFixed(1)} m, aires F ${c.zonage.aires.F.toFixed(0)} m², ` +
      `G ${c.zonage.aires.G.toFixed(0)} m², H ${c.zonage.aires.H.toFixed(0)} m², ` +
      `I ${c.zonage.aires.I.toFixed(0)} m², J ${c.zonage.aires.J.toFixed(0)} m².`,
    `Dépression appliquée à l’OSSATURE : coefficient moyen pondéré par les aires, ` +
      `cpe = ${c.zonage.cpeMoyen.toFixed(2)}, augmenté de la pression intérieure cpi = +${CPI_POSITIF.toFixed(2)}. ` +
      `La POINTE de rive vaut ${c.zonage.cpePointe.toFixed(2)} : c'est elle qui dimensionne la ` +
      `fixation du bac, et SteelPlan ne vérifie pas cette fixation.`,
    `Pression intérieure prise à ${CPI_POSITIF.toFixed(2)} ou ${CPI_NEGATIF.toFixed(2)} selon ce qui ` +
      'aggrave (EN 1991-1-4 § 7.2.9), bâtiment sans face dominante.',
  ];
  if (n.sAccidentelle > 0) {
    out.push(
      `Région ${n.sol.zone} : charge de neige ACCIDENTELLE sAd = ${n.sol.sAd.toFixed(2)} kN/m² au sol, ` +
        `soit ${n.sAccidentelle.toFixed(2)} kN/m² en toiture, vérifiée sous combinaison accidentelle.`,
    );
  }
  // Le bâtiment allongé n'est pas traité par le seul vent transversal.
  if (buildingLength(p.grid) > 4 * p.grid.span) {
    out.push(
      'Bâtiment très allongé : seul le vent TRANSVERSAL est appliqué au portique. Le vent en ' +
        'long pan, qui dimensionne la poutre au vent, n’est pris en compte que par le ' +
        'cheminement simplifié des contreventements.',
    );
  }
  return out;
}
