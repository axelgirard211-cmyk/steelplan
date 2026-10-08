import { getProfile } from '../../catalog/index';
import type { SteelGradeId } from '../../catalog/types';
import { FCK, type BasePlateParams, type BoltSpec } from '../../model/connections';
import { GAMMA_M0 } from '../section';
import { getGrade } from '../../catalog/index';
import { designationBoulon, fvRd, ftRd } from '../boulons';
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

export interface ContextePied {
  readonly id: string;
  readonly libelle: string;
  readonly cb: BasePlateParams;
  readonly profilPoteau: string;
  readonly nuance: SteelGradeId;
}

export function verifierPiedPoteau(
  c: ContextePied,
  compression: Reaction,
  soulevement: Reaction,
  cisaillement: Reaction,
  moment: Reaction,
): AssemblageCheck {
  const cb = c.cb;
  const profil = getProfile(c.profilPoteau);
  const verifs: VerifAssemblage[] = [];
  const ancrage: BoltSpec = {
    d: Math.min(30, Math.max(12, cb.anchorDiameter)) as BoltSpec['d'],
    cls: '8.8',
  };

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

  const nEd = Math.max(0, compression.fz) * 1000; // kN → N
  const mEd = Math.abs(moment.m) * 1e6; // kN·m → N·mm
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
   * ⚠ Deux sources de traction, et il faut la PLUS GRANDE des deux :
   *  - le soulèvement d'ensemble, quand le vent arrache le portique ;
   *  - l'équilibre de la platine sous grand excentrement, où les tiges tirent
   *    alors même que l'effort normal reste une compression.
   *
   * Ne regarder que le soulèvement laisserait un pied ENCASTRÉ sous fort moment
   * sans aucune vérification d'ancrage, alors que c'est exactement le cas où
   * l'ancrage travaille le plus.
   *
   * Et le soulèvement se compte SIGNE COMPRIS : une réaction négative veut dire
   * que la semelle retient la charpente. Prendre une valeur absolue ferait
   * vérifier l'ancrage sous le cas de compression, c'est-à-dire rien du tout.
   */
  const traction = Math.max(Math.max(0, -soulevement.fz) * 1000, equilibre.traction);
  const tigesTendues = Math.max(1, Math.floor(cb.anchorCount / 2));
  if (traction > 0) {
    verifs.push(
      verif(
        'traction des tiges d’ancrage',
        traction / tigesTendues / 1000,
        ftRd(ancrage) / 1000,
        'kN',
      ),
    );
  }

  /* ---------------- Cisaillement ---------------- */
  /*
   * En l'absence de bêche, l'effort horizontal passe par les tiges et par le
   * frottement sous la platine. On ne compte QUE les tiges : le frottement
   * dépend d'une compression qui peut ne pas être là au moment du vent.
   */
  const v = Math.abs(cisaillement.fy) * 1000;
  if (!cb.shearKey) {
    verifs.push(
      verif(
        'cisaillement des tiges',
        v / Math.max(1, cb.anchorCount) / 1000,
        fvRd(ancrage) / 1000,
        'kN',
      ),
    );
  }

  const nonCouvert = [
    'ancrage dans le béton : cône d’arrachement, adhérence et ferraillage de suspension ' +
      '(EN 1992-4). Une tige d’acier suffisante scellée dans un béton insuffisant s’arrache ' +
      'avec son cône.',
    'dimensionnement de la semelle elle-même : portance du sol, renversement, glissement',
  ];
  if (cb.shearKey) {
    nonCouvert.push('bêche de cisaillement : sa résistance et sa soudure ne sont pas calculées');
  }

  return assembler({
    id: c.id,
    libelle: c.libelle,
    boulon: `${cb.anchorCount} × Ø${cb.anchorDiameter} (${designationBoulon(ancrage)})`,
    sollicitations:
      `N = ${compression.fz.toFixed(1)} kN · ` +
      `soulèvement ${soulevement.fz.toFixed(1)} kN · ` +
      `V = ${cisaillement.fy.toFixed(1)} kN · ` +
      `M = ${moment.m.toFixed(1)} kN·m`,
    combinaison: compression.combinaison,
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
  /** Traction que les tiges doivent reprendre pour équilibrer (N). */
  readonly traction: number;
}

/**
 * Équilibre d'un pied sous effort normal ET moment.
 *
 * ⚠ Il y a DEUX régimes, et confondre les deux est ce qui faisait sortir un taux
 * infini sur le bâtiment industriel :
 *
 *  - petit excentrement : la résultante tombe dans le tiers central, toute la
 *    platine reste comprimée, les tiges ne travaillent pas ;
 *  - grand excentrement : la résultante sort de la platine. Le béton se
 *    concentre sur un bloc court près d'une rive et LES TIGES TIRENT, alors même
 *    que l'effort normal reste une compression.
 *
 * Le second régime n'est pas une anomalie à signaler mais un cas de calcul
 * ordinaire — c'est le fonctionnement normal d'un pied encastré. Le traiter
 * comme impossible revenait à condamner tous les portiques à pieds encastrés.
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

  // Pas de moment : compression uniforme, rien à résoudre.
  if (mEd <= 0) {
    return {
      compression: nEd,
      compressionMax,
      longueurComprimee: nEd > 0 ? L : 0,
      traction: 0,
    };
  }

  // Petit excentrement : la résultante reste dans le tiers central.
  const exc = nEd > 0 ? mEd / nEd : Infinity;
  if (exc <= L / 6) {
    // Contrainte de rive maximale, diagramme trapézoïdal.
    const sigma = nEd / (b * L) + mEd / ((b * L * L) / 6);
    return {
      compression: sigma * b * L,
      compressionMax,
      longueurComprimee: L,
      traction: 0,
    };
  }

  /*
   * Grand excentrement : bloc rectangulaire de longueur x contre une rive, tiges
   * tendues sur la rive opposée. Moments pris autour de la ligne des tiges :
   *   fjd·b·x·(dT − x/2) = N·(dT − L/2) + M
   * dont on retient la plus PETITE racine — le bloc le plus court qui équilibre.
   */
  const dT = L - Math.max(cb.anchorDiameter * 1.5, 30);
  const k = fjd * b;
  const rhs = nEd * (dT - L / 2) + mEd;
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
      traction: Math.max(0, requis - nEd),
    };
  }

  const x = Math.max(0, Math.min(L, dT - Math.sqrt(disc)));
  const c = k * x;
  return {
    compression: c,
    compressionMax,
    longueurComprimee: x,
    traction: Math.max(0, c - nEd),
  };
}
