import { hypothesesClimat } from '../climat/index';
import type { StructuralModel } from '../build/types';
import type { ProjectParams } from '../model/project';
import type { SensibiliteSecondOrdre } from '../analysis/secondOrdre';
import { kFlambementPlan } from './buckling';
import { hypothesesFroid } from './froid';

/**
 * Hypothèses de calcul, imprimées avec le rapport.
 *
 * Un résultat de calcul sans ses hypothèses n'est pas vérifiable, donc pas
 * utilisable. Elles sont donc produites par le code lui-même, à partir des
 * paramètres réels du projet, et non recopiées à la main dans une documentation
 * qui divergerait.
 */
export function hypotheses(
  p: ProjectParams,
  model: StructuralModel,
  sens: SensibiliteSecondOrdre | null = null,
): string[] {
  const pied = p.frame.baseFixity === 'encastre' ? 'encastrés' : 'articulés';
  const kPoteau = kFlambementPlan(p.frame.baseFixity, 'poteau', sens?.classe ?? 'instable');
  const h: string[] = [
    ...hypothesesClimat(p),
    ...hypothesesFroid(model.members.map((m) => m.profileId)),
    `Modèle : portique plan, pieds de poteaux ${pied}, assemblages traverse-poteau supposés rigides.`,
    `Coefficients partiels γM0 = γM1 = 1,00. Module d’Young E = 210 000 N/mm².`,
    `Longueur de flambement dans le plan : ${kPoteau.toFixed(2)} × hauteur pour les poteaux, ` +
      '1,00 × longueur pour les traverses et membrures.',
    'Imperfection d’aplomb φ = φ0·αh·αm (EN 1993-1-1 § 5.3.2) représentée par des forces ' +
      'horizontales équivalentes φ·V, ajoutées à toutes les combinaisons.',
  ];

  if (sens) {
    const nom =
      sens.classe === 'rigide'
        ? 'à nœuds fixes'
        : sens.classe === 'souple'
          ? 'à nœuds déplaçables, effets du second ordre amplifiés'
          : 'très souple';
    h.push(
      `Sensibilité au second ordre : αcr = ${
        Number.isFinite(sens.alphaCr) ? sens.alphaCr.toFixed(1) : '∞'
      } (EN 1993-1-1 § 5.2.1), ossature ${nom}` +
        (sens.amplification > 1
          ? `, efforts multipliés par ${sens.amplification.toFixed(2)}.`
          : '.'),
    );
    if (sens.classe === 'instable') {
      h.push(
        '⚠ αcr < 3 : l’EN 1993-1-1 exige une ANALYSE AU SECOND ORDRE complète, que SteelPlan ' +
          'ne réalise pas. Les efforts restent ceux du premier ordre — le facteur 1/(1 − 1/αcr) ' +
          'n’est plus valable dans ce domaine — et les longueurs de flambement forfaitaires sont ' +
          'conservées : les taux du portique ne valent pas vérification, le résultat doit être ' +
          'repris par un bureau d’études. Raidir l’ossature — pieds encastrés, jarrets, traverse ' +
          'plus haute — ramène αcr dans le domaine couvert.',
      );
    }
  }

  if (model.spacings.purlins > 0) {
    h.push(
      `Longueur de déversement des traverses : ${model.spacings.purlins.toFixed(0)} mm, ` +
        'soit l’entraxe réel des pannes — cela suppose la semelle comprimée maintenue. ' +
        'En zone de moment négatif (jarret) et sous soulèvement, c’est la semelle inférieure ' +
        'qui est comprimée : un bracon est alors nécessaire.',
    );
  } else {
    h.push('Aucune panne dans le modèle : le déversement est calculé sur la longueur entière.');
  }
  if (model.spacings.rails > 0) {
    h.push(
      `Maintien latéral des poteaux : ${model.spacings.rails.toFixed(0)} mm, entraxe réel des lisses.`,
    );
  }

  h.push(
    'Interaction flambement + déversement : somme linéaire, plus sévère que ' +
      'l’EN 1993-1-1 § 6.3.3 dans la quasi-totalité des cas.',
    'αcr est calculé par la formule simplifiée du § 5.2.1(4)B, valable pour un portique de ' +
      'pente modérée dont l’effort normal dans la traverse reste faible. Sur une toiture très ' +
      'pentue ou une ferme très chargée en compression, il faudrait le mode critique complet.',
    'Sections de CLASSE 4 hors domaine : SteelPlan ne calcule pas les sections efficaces de ' +
      'l’EN 1993-1-5. Une telle section est signalée pièce par pièce, et le dimensionnement ' +
      'automatique n’en propose jamais.',
    'C1 = 1,00 pour le moment critique de déversement (moment uniforme entre maintiens) : ' +
      'valeur conservative.',
    'Vent appliqué de façon simplifiée : pression sur la façade au vent, dépression uniforme ' +
      'sur les versants. Le zonage réel de l’EN 1991-1-4 demanderait d’appliquer chaque ' +
      'coefficient sur sa propre bande de toiture.',
    'Les jarrets ne sont pas pris en compte comme raidisseurs : leur inertie supplémentaire ' +
      'est négligée, ce qui majore légèrement le moment en travée.',
    'Élancement λ = Lcr/i limité à 200 sur les éléments comprimés principaux, 250 sur les ' +
      'barres de treillis, 350 sur pannes et lisses. Ce n’est PAS une exigence de l’EN 1993-1-1, ' +
      'qui n’en impose plus : c’est un critère de bonne pratique. Les contreventements et les ' +
      'liernes, tendus seuls, n’en reçoivent aucun.',
    `Flèches vérifiées sous combinaisons ELS caractéristiques : traverses L/${p.loads.deflection.rafter}, ` +
      `pannes L/${p.loads.deflection.purlin}, lisses L/${p.loads.deflection.rail}, ` +
      `déplacement en tête de poteau H/${p.loads.deflection.columnDrift}.`,
  );
  if (p.truss.enabled) {
    h.push(
      'Treillis : membrures continues, montants et diagonales articulés à leurs abouts — ' +
        'modélisation usuelle d’un assemblage boulonné sur gousset.',
      'Cornières JUMELÉES : chacune est vérifiée séparément, pour sa part de charge et avec sa ' +
        'propre inertie minimale. C’est du côté sûr — une paire dos à dos entretoisée par des ' +
        'fourrures est plus raide que la somme de ses deux cornières prises isolément.',
      'Barres de treillis : longueur de flambement égale à la maille, dans le plan comme hors ' +
        'plan. Hors plan, cela suppose la ferme intégrée à une toiture contreventée. Sous ' +
        'SOULÈVEMENT la membrure inférieure passe en compression : une lierne de stabilité ' +
        'devient nécessaire, et SteelPlan ne la construit pas.',
    );
  }
  return h;
}
