import { getProfile } from '../catalog/index';
import { gablePostStations } from '../build/buildSecondary';
import type { StructuralModel } from '../build/types';
import type { SteelGradeId } from '../catalog/types';
import { cutLengths, type Member, type MemberRole } from '../geometry/member';
import { bracedBays } from '../model/bracing';
import { leftSlopeRad, ridgeHeight, rightSlopeRad } from '../model/grid';
import { coefficientsToiture, CPI_NEGATIF } from '../climat/vent';
import { rad2deg } from '../math/tolerance';
import type { ProjectParams } from '../model/project';
import type { ActionId, ActionIntensities, Combination } from '../analysis/loadCases';
import { GAMMA_M1 } from './coefficients';
import { fyDe, verifierElement } from './element';
import { sectionEfficace, semelleLibre } from './froid';
import type { TractionDiagonale } from './assemblages/contreventement';
import { fusionner, pire, type AppuiPotelet, type CheckLine, type NonVerifie } from './types';

/**
 * OSSATURE SECONDAIRE ET CONTREVENTEMENT.
 *
 * Pannes, lisses, potelets et diagonales ne font pas partie du portique : les
 * inclure dans le modèle plan n'aurait aucun sens, ils travaillent dans d'autres
 * plans. Leurs sollicitations se calculent analytiquement — poutre sur deux
 * appuis, ou barre tendue — ce qui est ici exact et non approché.
 *
 * ⚠ Ce module existe pour que le code couleur 3D n'ait AUCUN trou : chaque barre
 * visible dans la vue doit avoir un taux de travail. Une pièce grise dans un
 * modèle coloré serait interprétée comme « vérifiée », alors qu'elle signifierait
 * « oubliée ».
 */

const E = 210_000;

export function checkSecondary(
  p: ProjectParams,
  model: StructuralModel,
  q: ActionIntensities,
  combs: readonly Combination[],
): { lines: CheckLine[]; exclus: NonVerifie[]; piedsPotelets: AppuiPotelet[]; tractions: TractionDiagonale[] } {
  // Un représentant par repère : deux pièces interchangeables ont, par
  // construction, la même vérification.
  const representants = new Map<string, Member>();
  for (const m of model.members) {
    if (PORTIQUE.includes(m.role)) continue;
    if (!representants.has(m.mark)) representants.set(m.mark, m);
  }

  const lines: CheckLine[] = [];
  const exclus: NonVerifie[] = [];
  const piedsPotelets: AppuiPotelet[] = [];
  const tractions: TractionDiagonale[] = [];
  for (const m of representants.values()) {
    const raison = RAISONS[m.role];
    if (raison) {
      exclus.push({ mark: m.mark, role: m.role, raison });
      continue;
    }
    let meilleure: CheckLine | null = null;
    let pied: AppuiPotelet | null = null;
    let traction: TractionDiagonale | null = null;
    for (const comb of combs) {
      /*
       * ⚠ Une panne reçoit le vent dans les DEUX sens : aspirée (dépression) ou
       * poussée (pression descendante, EN 1991-1-4 tableau 7.4a, valeurs
       * positives, aggravées par la dépression intérieure cpi = −0,3). Chaque
       * combinaison avec vent est examinée sous les deux, et la pire est
       * retenue : sans cela, la neige dominante était même SOULAGÉE par le vent
       * d'accompagnement, compté en soulèvement.
       */
      const sens: readonly SensVent[] = m.role === 'panne' && (comb.factors.W ?? 0) !== 0 ? ['souleve', 'pousse'] : ['souleve'];
      let ligne: CheckLine | null = null;
      for (const sv of sens) {
        const l = verifier(p, model, q, comb, m, sv);
        if (l) ligne = ligne ? fusionner(ligne, l) : l;
      }
      if (ligne) meilleure = meilleure ? fusionner(meilleure, ligne) : ligne;
      // Le pied d'un potelet sur deux appuis rend la moitié du vent : V = qL/2.
      if (ligne && m.role === 'potelet' && comb.kind === 'ELU' && (!pied || Math.abs(ligne.vEd) > pied.v)) {
        pied = { mark: m.mark, n: Math.abs(ligne.nEd), v: Math.abs(ligne.vEd), combinaison: ligne.combinaison };
      }
      // L'attache d'une diagonale se vérifie sous sa traction MAXIMALE, pas sous
      // la combinaison qui gouverne le taux de la barre.
      if (ligne && m.role === 'contreventement' && comb.kind === 'ELU' && (!traction || Math.abs(ligne.nEd) > traction.n)) {
        traction = { mark: m.mark, n: Math.abs(ligne.nEd), combinaison: ligne.combinaison };
      }
    }
    if (pied) piedsPotelets.push(pied);
    if (traction) tractions.push(traction);
    if (meilleure) lines.push(meilleure);
    else {
      exclus.push({
        mark: m.mark,
        role: m.role,
        raison: 'sollicitations non déterminables avec les paramètres actuels',
      });
    }
  }
  return { lines, exclus, piedsPotelets, tractions };
}

/**
 * Rôles hors du domaine de vérification, et la raison exacte.
 *
 * Les échantignolles sont des pièces d'assemblage : leur vérification relève du
 * calcul d'attache (cisaillement du boulon, flexion de l'aile sous l'excentrement
 * de la réaction de panne), pas du calcul de barre. Les barres libres sont, par
 * définition, sans rôle statique connu du logiciel.
 */
const RAISONS: Partial<Record<MemberRole, string>> = {
  attache:
    'pièce d’assemblage : relève du calcul d’attache (boulon et aile sollicités par ' +
    'la réaction de panne excentrée), non du calcul de barre',
  equerre:
    'pièce d’assemblage : équerre d’angle soudée, relève du calcul d’attache de la lisse',
  libre: 'barre ajoutée manuellement : son rôle statique n’est pas connu du logiciel',
};

const PORTIQUE: readonly MemberRole[] = [
  'poteau',
  'traverse',
  'console',
  'membrure-sup',
  'membrure-inf',
  'montant',
  'diagonale',
];

/* ------------------------------------------------------------------ */

/** Sens du vent sur la toiture, pour une panne. */
type SensVent = 'souleve' | 'pousse';

/**
 * Pression de vent DESCENDANTE sur une panne (kN/m², perpendiculaire au rampant).
 *
 * qp × (cpe,10 positif le plus fort des zones G et H − cpi), avec cpi = −0,3
 * (EN 1991-1-4 § 7.2.9) : la dépression intérieure tire la couverture vers le
 * bas, si bien qu'il y a une pression nette même sur une toiture presque plate
 * (cpe = 0).
 *
 * En saisie manuelle qp n'est pas connue : on la déduit de la pression de
 * façade saisie, qp·(cpe,D − cpi), en prenant cpe,D = 0,7 — la plus petite
 * valeur du tableau 7.1 —, ce qui la MAJORE. Prendre la pression de façade
 * elle-même aurait triplé la pression d'une toiture faiblement pentue.
 */
function ventDescendant(p: ProjectParams, q: ActionIntensities): number {
  const qp = q.qp > 0 ? q.qp : q.wMur / (0.7 - CPI_NEGATIF);
  const c = coefficientsToiture(Math.abs(rad2deg(leftSlopeRad(p.grid))));
  return qp * (Math.max(c.G[1], c.H[1], 0) - CPI_NEGATIF);
}

function verifier(
  p: ProjectParams,
  model: StructuralModel,
  q: ActionIntensities,
  comb: Combination,
  m: Member,
  sensVent: SensVent = 'souleve',
): CheckLine | null {
  const g = (a: ActionId): number => comb.factors[a] ?? 0;
  const profil = getProfile(m.profileId);
  const L = cutLengths(m).axis;
  const poidsPropre = p.loads.loads.includeSelfWeight ? (profil.G * 9.81) / 1000 : 0;
  const els = comb.kind === 'ELS';
  const lim = p.loads.deflection;

  let qFort = 0; // charge linéique d'axe fort (N/mm)
  let qFaible = 0; // charge linéique d'axe faible (N/mm)
  let lFaible = L; // portée de flexion d'axe faible
  let nEd = 0;
  let limiteFleche = 0;

  switch (m.role) {
    case 'panne': {
      const e = model.spacings.purlins;
      if (e <= 0) return null;
      const alpha = (leftSlopeRad(p.grid) + rightSlopeRad(p.grid)) / 2;
      // Charges par m² de RAMPANT : la bande reprise vaut l'entraxe.
      const gv = (g('G') * q.gToit * e) / 1000 + g('G') * poidsPropre;
      // Charges par m² de PROJECTION : la bande horizontale vaut e·cos α.
      const sv =
        ((g('Q') * q.qToit + g('S') * q.sToit + g('Sacc') * q.sAccToit) * e * Math.cos(alpha)) /
        1000;
      const vertical = gv + sv;
      // Vent : perpendiculaire au rampant ; la dépression s'oppose à la gravité,
      // la pression descendante s'y ajoute.
      const vent =
        sensVent === 'pousse'
          ? (g('W') * ventDescendant(p, q) * e) / 1000
          : -(g('W') * q.wToit * e) / 1000;

      qFort = vertical * Math.cos(alpha) + vent;
      qFaible = vertical * Math.sin(alpha);
      // Les liernes réduisent la portée de flexion d'axe faible : c'est toute
      // leur raison d'être, et l'ignorer condamnerait des pannes correctes.
      const rangs = p.secondary.purlins.sagBars.enabled ? p.secondary.purlins.sagBars.rows : 0;
      lFaible = L / (rangs + 1);
      limiteFleche = els && lim.purlin > 0 ? L / lim.purlin : 0;
      break;
    }

    case 'lisse': {
      const e = model.spacings.rails;
      if (e <= 0) return null;
      // Le vent est la charge dimensionnante d'une lisse ; son poids propre la
      // fléchit dans l'autre plan.
      qFort = (g('W') * Math.max(q.wMur, q.wToit) * e) / 1000;
      qFaible = g('G') * poidsPropre;
      limiteFleche = els && lim.rail > 0 ? L / lim.rail : 0;
      break;
    }

    case 'potelet': {
      const e = entraxePotelets(p);
      qFort = (g('W') * q.wMur * e) / 1000;
      qFaible = 0;
      nEd = -g('G') * poidsPropre * L; // compression sous son propre poids
      limiteFleche = els && lim.rail > 0 ? L / lim.rail : 0;
      break;
    }

    case 'contreventement':
    case 'lierne': {
      // Barres tendues : pas de flexion, pas de flèche à vérifier.
      if (comb.kind === 'ELS') return null;
      nEd = effortDeTraction(p, model, q, comb, m, L);
      break;
    }

    default:
      return null;
  }

  const myEd = (qFort * L * L) / 8;
  const mzEd = (qFaible * lFaible * lFaible) / 8;
  const vEd = (qFort * L) / 2;

  // Flèche d'une poutre sur deux appuis sous charge répartie.
  const fleche =
    limiteFleche > 0 && profil.Iy > 0
      ? {
          valeur: Math.abs((5 * qFort * L ** 4) / (384 * E * profil.Iy)),
          limite: limiteFleche,
        }
      : null;

  const check = verifierElement(
    m.profileId,
    m.grade,
    m.role,
    { nEd, myEd, mzEd, vEd },
    // Une panne ou une lisse est maintenue par le bac de couverture d'un côté ;
    // on retient la portée entière, ce qui est du côté sûr.
    { lcrY: L, lcrZ: lFaible, lLT: lFaible },
    fleche ? fleche.valeur / fleche.limite : 0,
  );

  /*
   * Semelle libre des profils FORMÉS À FROID : le contrôle que le calcul de
   * barre ne fait pas pour eux (voir `semelleLibre`).
   */
  const libre = semelleLibreComprimee(p, m, profil, myEd, L, lFaible);
  const ratios = libre
    ? { ...check.ratios, stabilite: Math.max(check.ratios.stabilite, libre.ratio) }
    : check.ratios;
  const avertissements = [
    ...check.avertissements,
    ...(libre ? [libre.message] : []),
    // Le libellé de combinaison ne dit pas le sens du vent : on l'écrit ici.
    ...(sensVent === 'pousse'
      ? [
          `Vent examiné dans les deux sens : dépression ${q.wToit.toFixed(2)} kN/m² et pression ` +
            `descendante ${ventDescendant(p, q).toFixed(2)} kN/m² (EN 1991-1-4 tab. 7.4a, cpi = −0,3).`,
        ]
      : []),
  ];

  const { ratio, gouverne } = pire(ratios);
  return {
    mark: m.mark,
    role: m.role,
    profileId: m.profileId,
    grade: m.grade as SteelGradeId,
    cls: check.cls,
    combinaison: `${comb.id} — ${comb.label}`,
    nEd: nEd / 1000,
    myEd: myEd / 1e6,
    mzEd: mzEd / 1e6,
    vEd: vEd / 1000,
    ratios,
    elancement: check.elancement,
    ratio,
    gouverne,
    fleche,
    avertissements,
    lcrY: L,
    lcrZ: lFaible,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Semelle libre comprimée d'une panne ou d'une lisse formée à froid.
 *
 * QUAND elle est comprimée :
 *  — PANNE : sous SOULÈVEMENT seulement, quand le moment s'inverse. Sous la
 *    gravité, c'est l'aile haute qui est comprimée, et le bac la tient ;
 *  — LISSE : toujours en jeu, car le vent la charge dans les deux sens et le
 *    calcul ne retient que l'intensité. Sous dépression, l'aile intérieure —
 *    celle qui ne porte pas le bardage — est comprimée et libre.
 *
 * Les LIERNES sont comptées comme maintiens latéraux de la semelle libre d'une
 * panne : c'est l'hypothèse de l'EN 1993-1-3 pour des liernes attachées près de
 * cette semelle. Des liernes fixées sur l'aile haute seule ne la tiendraient
 * pas : le rapport le rappelle.
 */
function semelleLibreComprimee(
  p: ProjectParams,
  m: Member,
  profil: ReturnType<typeof getProfile>,
  myEd: number,
  L: number,
  lFaible: number,
): { ratio: number; message: string } | null {
  if (profil.shape !== 'Z' && profil.shape !== 'C') return null;
  if (m.role === 'panne' && myEd >= 0) return null;
  if (m.role !== 'panne' && m.role !== 'lisse') return null;

  const fy = fyDe(profil, m.grade);
  const lfz = m.role === 'panne' ? lFaible : L;
  // Lisse : la semelle libre peut être l'une ou l'autre, on retient la pire.
  const ailes: ('haute' | 'basse')[] = m.role === 'panne' ? ['basse'] : ['haute', 'basse'];
  let pire: { ratio: number; chi: number; lambda: number } | null = null;
  for (const aile of ailes) {
    const sl = semelleLibre(profil, fy, lfz, aile);
    const weff = sectionEfficace(profil, fy, aile).Weff;
    const ratio = Math.abs(myEd) / ((sl.chiLT * weff * fy) / GAMMA_M1);
    if (!pire || ratio > pire.ratio) pire = { ratio, chi: sl.chiLT, lambda: sl.lambdaFz };
  }
  if (!pire) return null;

  const liernes =
    m.role === 'panne' && p.secondary.purlins.sagBars.enabled
      ? ' Les liernes sont comptées comme maintiens de cette semelle : elles doivent lui être attachées.'
      : '';
  return {
    ratio: pire.ratio,
    message:
      `Semelle libre comprimée (EN 1993-1-3 § 10.1.4) : λfz = ${pire.lambda.toFixed(2)}, ` +
      `χLT = ${pire.chi.toFixed(2)} sur ${(lfz / 1000).toFixed(2)} m entre maintiens, sans ` +
      'maintien attribué au bac (conservatif). La flexion latérale de la semelle libre n’est PAS ' +
      'calculée : à vérifier sur les tables du fabricant.' +
      liernes,
  };
}

/**
 * Entraxe réel des potelets de pignon (mm).
 *
 * ⚠ Lu sur les potelets POSÉS, pas sur le seul champ « nombre » : en mode
 * entraxe, ce champ ne sert pas, et le calcul chargeait des potelets fictifs —
 * 3 par défaut — quand le pignon en portait 4 ou 5.
 */
function entraxePotelets(p: ProjectParams): number {
  return p.grid.span / (gablePostStations(p).length + 1);
}

/**
 * Réaction d'une lierne, en fraction de q·L (q parallèle au rampant, L la
 * travée de la panne).
 *
 * ⚠ La panne est CONTINUE sur ses liernes, en flexion d'axe faible : la lierne
 * n'est pas l'appui d'une poutre isostatique mais l'appui intermédiaire d'une
 * poutre continue, qui en reçoit davantage. Une rangée : poutre à deux travées
 * égales, appui central 1,25 × q·L/2 = 0,625·q·L, et non q·L/2. Deux rangées :
 * trois travées, appuis intérieurs 1,10 × q·L/3. Au-delà, 1,143 × q·L/(n + 1),
 * le coefficient de la poutre à quatre travées, enveloppe des suivantes.
 */
export function reactionLierne(rangees: number): number {
  const n = Math.max(1, Math.round(rangees));
  if (n === 1) return 0.625;
  if (n === 2) return 1.1 / 3;
  return 1.143 / (n + 1);
}

/**
 * Effort de traction dans une diagonale de contreventement ou une lierne.
 *
 * ⚠ CHEMINEMENT SIMPLIFIÉ, à connaître avant d'utiliser le résultat. La force du
 * vent sur un pignon se partage entre le niveau du sol, où les potelets la
 * transmettent directement aux fondations, et le niveau de la toiture, où la
 * poutre au vent la conduit jusqu'aux palées de stabilité des deux long-pans. On
 * retient un partage par moitié, puis une répartition égale entre les palées.
 * Un calcul complet tiendrait compte de la raideur relative des palées.
 */
function effortDeTraction(
  p: ProjectParams,
  model: StructuralModel,
  q: ActionIntensities,
  comb: Combination,
  m: Member,
  L: number,
): number {
  const g = comb.factors.W ?? 0;
  if (m.role === 'lierne') {
    // Une lierne reprend la composante parallèle au rampant des pannes qu'elle
    // suspend. Cas le plus chargé : celle qui est proche du faîtage.
    const e = model.spacings.purlins;
    const alpha = (leftSlopeRad(p.grid) + rightSlopeRad(p.grid)) / 2;
    const gv = ((comb.factors.G ?? 0) * q.gToit * e) / 1000;
    const sv = (((comb.factors.S ?? 0) * q.sToit) * e * Math.cos(alpha)) / 1000;
    const parallele = (gv + sv) * Math.sin(alpha);
    const nPannes = Math.max(1, Math.round(p.grid.span / 2 / Math.max(e, 1)));
    return parallele * p.grid.baySpacing * reactionLierne(p.secondary.purlins.sagBars.rows) * nPannes;
  }

  if (g === 0) return 0;

  // Aire du pignon : rectangle sous l'égout + triangle jusqu'au faîtage.
  const airePignon =
    (p.grid.span * p.grid.eaveHeight +
      (p.grid.span * (ridgeHeight(p.grid) - p.grid.eaveHeight)) / 2) /
    1e6; // m²
  const force = g * q.wMur * airePignon * 1000; // N

  const nPalees = Math.max(1, bracedBays(p.bracing.wall, p.grid.nBays).length);
  const parPalee = force / 2 / (2 * nPalees);

  // La diagonale ne reprend que la composante suivant son axe : plus elle est
  // couchée, plus l'effort augmente.
  const dx = Math.abs(m.end.x - m.start.x);
  const cos = L > 0 ? dx / L : 1;
  return parPalee / Math.max(0.2, cos);
}
