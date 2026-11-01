import { getGrade, getProfile } from '../../catalog/index';
import type { SteelGradeId } from '../../catalog/types';
import {
  FCK,
  positionsDesAncrages,
  type BasePlateParams,
  type BoltSpec,
  type ClasseTige,
} from '../../model/connections';
import { GAMMA_M0 } from '../section';
import { aireResistante, GAMMA_M2 } from '../boulons';
import type { Reaction } from '../reactions';
import { assembler, verif, type AssemblageCheck, type VerifAssemblage } from './types';

/**
 * PIED DE POTEAU — platine sur béton et tiges d'ancrage.
 *
 * ⚠ C'est l'assemblage dont dépendent les fondations, et il n'était pas vérifié
 * du tout. Deux questions décident du volume de béton, et une seule d'entre
 * elles concerne l'acier :
 *  - le béton tient-il la compression sous la platine ?
 *  - les tiges tiennent-elles l'arrachement sous le vent ?
 *
 * Ce module répond aux deux du côté ACIER et du côté PRESSION. Il ne calcule PAS
 * l'ancrage dans le béton — cône d'arrachement, adhérence, ferraillage de
 * suspension — qui relève de l'EN 1992-4 et de la fondation, pas de la charpente.
 * Cette limite est portée au rapport : une tige d'acier suffisante scellée dans
 * un béton insuffisant s'arrache avec son cône.
 */

/** Facteur du matériau de scellement, EN 1993-1-8 § 6.2.5. */
const BETA_J = 2 / 3;
/** Coefficient partiel du béton, EN 1992-1-1. */
const GAMMA_C = 1.5;

/** Limite d'élasticité et résistance ultime des tiges, EN 1993-1-8 tableau 3.1 (N/mm²). */
const TIGES: Readonly<Record<ClasseTige, { fyb: number; fub: number }>> = {
  '4.6': { fyb: 240, fub: 400 },
  '5.6': { fyb: 300, fub: 500 },
  '8.8': { fyb: 640, fub: 800 },
};

export interface ResistancesTige {
  /** Traction Ft,Rd (N), k2 = 0,9 : EN 1993-1-8 tableau 3.4. */
  readonly ftRd: number;
  /** Cisaillement F2,vb,Rd (N), EN 1993-1-8 § 6.2.2(7). */
  readonly fvbRd: number;
  readonly alphaBc: number;
}

/**
 * Résistances d'UNE tige d'ancrage.
 *
 * ⚠ Le cisaillement d'une tige n'est PAS celui d'un boulon : le § 6.2.2(7)
 * remplace αv = 0,6 par αbc = 0,44 − 0,0003·fyb, qui pénalise les aciers à
 * haute limite élastique — une tige scellée fléchit dans son mortier avant de
 * cisailler, et une tige raide le supporte mal. Pour une 8.8 αbc vaut 0,248 :
 * le calcul « boulon » surestimait sa résistance au cisaillement de 140 %.
 */
export function resistancesTige(diametre: number, classe: ClasseTige): ResistancesTige {
  const d = Math.min(30, Math.max(12, diametre)) as BoltSpec['d'];
  const { fyb, fub } = TIGES[classe] ?? TIGES['4.6'];
  const as = aireResistante({ d, cls: '8.8' }); // As ne dépend que du diamètre
  const alphaBc = 0.44 - 0.0003 * Math.min(640, Math.max(235, fyb));
  return {
    ftRd: (0.9 * fub * as) / GAMMA_M2,
    fvbRd: (alphaBc * fub * as) / GAMMA_M2,
    alphaBc,
  };
}

export interface ContextePied {
  readonly id: string;
  readonly libelle: string;
  readonly cb: BasePlateParams;
  readonly profilPoteau: string;
  readonly nuance: SteelGradeId;
}

/**
 * Vérification du pied sous une liste de réactions, chacune CONCOMITANTE —
 * N, V et M d'une même combinaison. On rend la plus défavorable.
 *
 * ⚠ Ne JAMAIS mêler les extrêmes de combinaisons différentes. On croisait la
 * compression maximale (gravitaire) avec le moment maximal (vent) : un couple
 * qui n'existe pas, trop sévère pour le béton et — surtout — trop clément pour
 * les tiges. Le cas qui les arrache est le soulèvement ACCOMPAGNÉ de son moment
 * (« 1,0 G + 1,5 W ») : N tire, M fait tirer davantage la rangée tendue, et
 * aucune compression ne vient l'équilibrer. Il n'était jamais formé.
 */
export function verifierPiedPoteau(c: ContextePied, ...cas: readonly Reaction[]): AssemblageCheck {
  let pire: AssemblageCheck | null = null;
  for (const r of cas) {
    const v = verifierCas(c, r);
    if (!pire || v.ratio > pire.ratio) pire = v;
  }
  return pire ?? verifierCas(c, { fz: 0, fy: 0, m: 0, combinaison: '—' });
}

function verifierCas(c: ContextePied, r: Reaction): AssemblageCheck {
  const cb = c.cb;
  const profil = getProfile(c.profilPoteau);
  const verifs: VerifAssemblage[] = [];
  const tige = resistancesTige(cb.anchorDiameter, cb.anchorClass);

  /* ---------------- Pression sur le béton ---------------- */
  /*
   * ⚠ La pression admissible n'est PAS fcd. Le confinement du béton sous une
   * platine posée sur un massif plus large permet d'aller au-delà, mais le
   * mortier de calage, lui, limite : d'où le βj = 2/3 de la norme. Prendre fcd
   * directement surestime de 50 % la portance et conduit à des platines trop
   * petites, qui poinçonnent leur massif.
   */
  const fcd = FCK[cb.concrete] / GAMMA_C;
  const fjd = BETA_J * fcd;

  // N SIGNÉ : positif comprime la semelle, négatif l'arrache.
  const nEd = r.fz * 1000; // kN → N
  const mEd = Math.abs(r.m) * 1e6; // kN·m → N·mm
  const equilibre = equilibrePied(nEd, mEd, cb, fjd);

  verifs.push(
    verif(
      `pression sur béton ${cb.concrete}`,
      equilibre.compression / 1000,
      equilibre.compressionMax / 1000,
      'kN',
    ),
  );

  /* ---------------- Flexion de la platine ---------------- */
  /*
   * La platine porte en console au-delà de la semelle du poteau. La pression du
   * bloc comprimé y crée un moment que l'épaisseur doit reprendre.
   */
  const debord = Math.max(0, (cb.length - profil.h) / 2);
  if (debord > 0 && equilibre.longueurComprimee > 0) {
    const pression = equilibre.compression / (cb.width * equilibre.longueurComprimee);
    const mParMm = (pression * Math.min(debord, equilibre.longueurComprimee) ** 2) / 2;
    const fy = getGrade(c.nuance).fy;
    const mRdParMm = (cb.thickness * cb.thickness * fy) / 4 / GAMMA_M0;
    verifs.push(verif('flexion de la platine', mParMm, mRdParMm, 'N·mm/mm'));
  }

  /* ---------------- Traction des tiges ---------------- */
  /*
   * ⚠ Deux sources de traction, et elles se CUMULENT dans un même cas :
   *  - le soulèvement d'ensemble, quand le vent arrache le portique ;
   *  - l'équilibre de la platine sous moment, où la rangée tendue tire alors
   *    même que l'effort normal peut rester une compression.
   * C'est l'équilibre concomitant (N, M) qui les donne ensemble.
   */
  const ft = equilibre.tractionParTige;
  if (ft > 0) {
    verifs.push(verif('traction des tiges d’ancrage', ft / 1000, tige.ftRd / 1000, 'kN'));
  }

  /* ---------------- Cisaillement ---------------- */
  /*
   * En l'absence de bêche, l'effort horizontal passe par les tiges et par le
   * frottement sous la platine. On ne compte QUE les tiges : le frottement
   * dépend d'une compression qui peut ne pas être là au moment du vent.
   */
  const fv = (Math.abs(r.fy) * 1000) / Math.max(1, cb.anchorCount);
  if (!cb.shearKey) {
    verifs.push(verif('cisaillement des tiges', fv / 1000, tige.fvbRd / 1000, 'kN'));
    /*
     * Interaction, EN 1993-1-8 tableau 3.4 : Fv/Fv,Rd + Ft/(1,4·Ft,Rd) ≤ 1. Elle
     * n'a de sens que parce que V et T viennent désormais de la MÊME
     * combinaison : croiser deux extrêmes l'aurait rendue arbitraire.
     */
    if (ft > 0 && fv > 0) {
      const taux = fv / tige.fvbRd + ft / (1.4 * tige.ftRd);
      verifs.push(verif('traction et cisaillement des tiges', taux, 1, '—'));
    }
  }

  const nonCouvert = [
    'ancrage dans le béton : cône d’arrachement, adhérence et ferraillage de suspension ' +
      '(EN 1992-4). Une tige d’acier suffisante scellée dans un béton insuffisant s’arrache ' +
      'avec son cône.',
    'dimensionnement de la semelle elle-même : portance du sol, renversement, glissement',
    'flexion de la platine sous la traction des tiges (tronçon en T, EN 1993-1-8 § 6.2.6.11) ' +
      'et pression diamétrale de la platine sur les tiges (F1,vb,Rd)',
  ];
  if (cb.shearKey) {
    nonCouvert.push('bêche de cisaillement : sa résistance et sa soudure ne sont pas calculées');
  }

  return assembler({
    id: c.id,
    libelle: c.libelle,
    boulon: `${cb.anchorCount} tiges M${cb.anchorDiameter} ${cb.anchorClass}`,
    // N, V et M d'une même combinaison ; N négatif : soulèvement.
    sollicitations: `N = ${r.fz.toFixed(1)} kN · V = ${r.fy.toFixed(1)} kN · M = ${r.m.toFixed(1)} kN·m`,
    combinaison: r.combinaison,
    verifs,
    nonCouvert,
  });
}

/* ------------------------------------------------------------------ */

interface EquilibrePied {
  /** Résultante de compression du bloc de béton (N). */
  readonly compression: number;
  /** Ce que le bloc pourrait au maximum reprendre, platine entière (N). */
  readonly compressionMax: number;
  /** Longueur du bloc comprimé (mm). */
  readonly longueurComprimee: number;
  /** Traction de la tige la plus tendue (N). */
  readonly tractionParTige: number;
}

/**
 * Équilibre d'un pied sous effort normal SIGNÉ et moment concomitants.
 *
 * ⚠ Il y a TROIS régimes, et confondre les deux premiers est ce qui faisait
 * sortir un taux infini sur le bâtiment industriel :
 *
 *  - petit excentrement : la résultante tombe dans le tiers central, toute la
 *    platine reste comprimée, les tiges ne travaillent pas ;
 *  - grand excentrement : la résultante sort de la platine. Le béton se
 *    concentre sur un bloc court près d'une rive et LA RANGÉE OPPOSÉE TIRE,
 *    que l'effort normal soit une compression ou une traction modérée ;
 *  - traction dominante : aucun bloc ne se forme, les deux rangées extrêmes
 *    tirent, la plus éloignée de M davantage.
 *
 * La géométrie est celle que pose la construction (`positionsDesAncrages`) :
 * rangée tendue, nombre de tiges qu'elle compte. Seules les deux rangées
 * EXTRÊMES sont comptées — une rangée médiane, plus près du centre, est
 * négligée, ce qui est du côté sûr.
 */
function equilibrePied(
  nEd: number,
  mEd: number,
  cb: BasePlateParams,
  fjd: number,
): EquilibrePied {
  const L = cb.length;
  const b = cb.width;
  const compressionMax = fjd * b * L;

  const positions = positionsDesAncrages(cb);
  const zMax = positions.reduce((m, q) => Math.max(m, q.z), 0);
  const parRangee = Math.max(1, positions.filter((q) => Math.abs(q.z - zMax) < 1).length);
  // Bras de levier : de la rive comprimée à la rangée tendue, et entre rangées.
  const dT = L / 2 + zMax;
  const entreRangees = Math.max(2 * zMax, 1);

  // Petit excentrement : la résultante reste dans le tiers central.
  if (nEd > 0 && mEd <= (nEd * L) / 6) {
    // Contrainte de rive maximale, diagramme trapézoïdal.
    const sigma = nEd / (b * L) + mEd / ((b * L * L) / 6);
    return { compression: sigma * b * L, compressionMax, longueurComprimee: L, tractionParTige: 0 };
  }

  /*
   * Bloc rectangulaire de longueur x contre une rive, rangée tendue sur la rive
   * opposée. Moments pris autour de la ligne des tiges tendues :
   *   fjd·b·x·(dT − x/2) = N·(dT − L/2) + M
   * dont on retient la plus PETITE racine — le bloc le plus court qui équilibre.
   */
  const rhs = nEd * (dT - L / 2) + mEd;

  if (rhs <= 0) {
    /*
     * Traction dominante (N < 0, M ≤ |N|·zMax) : pas de béton comprimé. La
     * rangée la plus tendue reçoit sa moitié de |N| plus le couple M / bras.
     */
    const rangee = -nEd / 2 + mEd / entreRangees;
    return { compression: 0, compressionMax, longueurComprimee: 0, tractionParTige: Math.max(0, rangee) / parRangee };
  }

  const k = fjd * b;
  const disc = dT * dT - (2 * rhs) / k;
  if (disc < 0) {
    /*
     * Aucun bloc ne peut équilibrer : la platine est trop courte pour ce moment.
     * On rend la compression qu'il FAUDRAIT, pour que le taux dise de combien on
     * dépasse — un taux infini ne dit pas quoi changer.
     */
    const requis = rhs / Math.max(1, dT - L / 4);
    return {
      compression: Math.max(nEd, requis),
      compressionMax,
      longueurComprimee: L,
      tractionParTige: Math.max(0, requis - nEd) / parRangee,
    };
  }

  const x = Math.max(0, Math.min(L, dT - Math.sqrt(disc)));
  const c = k * x;
  return {
    compression: c,
    compressionMax,
    longueurComprimee: x,
    tractionParTige: Math.max(0, c - nEd) / parRangee,
  };
}
