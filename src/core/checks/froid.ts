import { rect, type Rect } from '../catalog/geom';
import type { ColdProfile } from '../catalog/types';
import { GAMMA_M0 } from './coefficients';

/**
 * SECTION EFFICACE DES PROFILS FORMÉS À FROID — EN 1993-1-3.
 *
 * ⚠⚠ SANS CE MODULE, LES PANNES Z ET C SERAIENT DANGEREUSES. La classification
 * de l'EN 1993-1-1 ne connaît ni les lèvres ni le flambement par distorsion :
 * un Z tombait dans aucune de ses branches et ressortait en CLASSE 1, « section
 * pleine ». Une tôle de 2 mm était donc vérifiée en plastique, avec Wpl — soit
 * une résistance surestimée de moitié sur une section qui, en réalité, voile
 * localement bien avant de plastifier.
 *
 * La méthode suivie est celle du § 5.5 : on remplace chaque paroi comprimée par
 * sa LARGEUR EFFICACE, on réduit le raidisseur de rive par son coefficient de
 * flambement par distorsion χd, et on recalcule le module de flexion sur la
 * section ainsi amputée. C'est ce module réduit, Weff, qui donne la résistance.
 *
 * ⚠ CE QUI N'EST PAS COUVERT, et qu'il faut savoir avant d'employer ces
 * profils :
 *  — l'effort NORMAL combiné à la flexion (§ 6.1.9) : une panne qui sert aussi
 *    de barre de contreventement n'est pas vérifiée ici ;
 *  — la FLEXION LATÉRALE de la semelle libre sous soulèvement (terme Mfz du
 *    § 10.1.4.2). Sa STABILITÉ, elle, est vérifiée (`semelleLibre`), sans
 *    maintien attribué au bac — ce qui est du côté de la sécurité ;
 *  — la résistance aux charges locales sur appui (§ 6.1.7, « web crippling »),
 *    dimensionnante sur les appuis courts ;
 *  — la continuité par emboîtement des Z sur appui, qui change tout le schéma
 *    statique.
 * Ces points relèvent des tables du fabricant, qui les couvrent par essais.
 *
 * ⚠ FLEXION D'AXE FORT SEULEMENT, et les ailes d'un Z y sont replacées du même
 * côté que celles d'un C. Ce n'est pas une approximation : l'inertie d'axe fort
 * ne dépend que des distances à l'axe et des aires, jamais du côté vers lequel
 * une aile pointe. En revanche cela revient à supposer la panne MAINTENUE par
 * le bac — l'hypothèse du § 10.1 — car un Z libre fléchit de biais, ses axes
 * principaux étant inclinés. Une panne non maintenue sort du domaine calculé
 * ici.
 */

/** Module d'Young de l'acier (N/mm²). */
const E = 210_000;

/** Coefficient de Poisson. */
const NU = 0.3;

export interface SectionEfficace {
  /** Module de flexion efficace (mm³), fibre comprimée. */
  readonly Weff: number;
  /** Moment résistant (N·mm). */
  readonly McRd: number;
  /** Aire efficace conservée (mm²) et part de la section brute. */
  readonly Aeff: number;
  readonly rendement: number;
  /** Coefficient de flambement par distorsion du raidisseur de rive. */
  readonly chiD: number;
  /** Largeur efficace de l'aile comprimée (mm) et de sa lèvre. */
  readonly aileEfficace: number;
  readonly levreEfficace: number;
  /** Ce qui gouverne la réduction, pour l'expliquer au projeteur. */
  readonly gouverne: string;
}

/**
 * Coefficient de réduction d'une paroi comprimée, EN 1993-1-5 § 4.4.
 *
 * ⚠ `psi` est le rapport des contraintes aux deux bords, −1 en flexion pure.
 * Le passer à 1 pour une âme fléchie donnerait une largeur efficace bien trop
 * faible : l'âme d'une panne serait amputée de moitié sans raison.
 */
function rho(bp: number, t: number, epsilon: number, kSigma: number, psi: number): number {
  const lambdaP = bp / t / (28.4 * epsilon * Math.sqrt(kSigma));
  if (lambdaP <= 0.673) return 1;
  const r = (lambdaP - 0.055 * (3 + psi)) / (lambdaP * lambdaP);
  return Math.min(1, Math.max(0, r));
}

/**
 * Coefficient de voilement d'une lèvre, § 5.5.3.2(5).
 *
 * La lèvre est une paroi en console, mais son maintien dépend de sa proportion
 * par rapport à l'aile qui la porte : une lèvre courte est bien tenue, une lèvre
 * longue l'est mal.
 */
function kSigmaLevre(bpc: number, bp: number): number {
  const ratio = bpc / bp;
  if (ratio <= 0.35) return 0.5;
  return 0.5 + 0.83 * Math.cbrt((ratio - 0.35) ** 2);
}

/**
 * Réduction par flambement par DISTORSION, § 5.5.3.1(7).
 *
 * ⚠ C'est le mode propre aux profils à lèvres, et celui qu'aucune règle de
 * l'EN 1993-1-1 ne décrit : l'aile comprimée et sa lèvre pivotent ensemble
 * autour de la jonction avec l'âme, comme un raidisseur sur appui élastique.
 * L'ignorer laisserait croire qu'une lèvre est toujours efficace.
 */
function chiDistorsion(lambdaD: number): number {
  if (lambdaD <= 0.65) return 1;
  if (lambdaD < 1.38) return 1.47 - 0.723 * lambdaD;
  return 0.66 / lambdaD;
}

/**
 * Section efficace en flexion d'axe fort.
 *
 * @param comprimee quelle aile est comprimée : `haute` sous charge descendante
 *   (neige, poids propre), `basse` sous soulèvement (vent). Les deux ne donnent
 *   pas le même module — sur un Z les ailes n'ont pas la même largeur, et c'est
 *   l'aile comprimée qui décide.
 */
export function sectionEfficace(
  p: ColdProfile,
  fy: number,
  comprimee: 'haute' | 'basse' = 'haute',
): SectionEfficace {
  const t = p.t;
  const epsilon = Math.sqrt(235 / fy);

  /*
   * Largeurs planes NOTIONNELLES (§ 5.1) : mesurées entre fibres moyennes des
   * parois voisines, non pas hors tout. Prendre les cotes extérieures
   * compterait deux fois l'épaisseur à chaque pli et surestimerait chaque paroi.
   */
  const aileComprimee = comprimee === 'haute' ? p.aile2 : p.aile;
  const bpFlange = aileComprimee - t;
  const bpLip = p.c - t / 2;
  const bpWeb = p.h - t;

  /* --- 1. Aile comprimée, paroi interne raidie sur une rive (kσ = 4) --- */
  const rhoFlange = rho(bpFlange, t, epsilon, 4, 1);
  const beff = rhoFlange * bpFlange;
  // La part efficace côté lèvre : c'est elle qui forme le raidisseur.
  const be2 = 0.5 * beff;

  /* --- 2. Lèvre, console dont le maintien dépend de sa proportion --- */
  const rhoLip = rho(bpLip, t, epsilon, kSigmaLevre(bpLip, bpFlange), 1);
  const ceff = rhoLip * bpLip;

  /* --- 3. Flambement par distorsion du raidisseur (aile + lèvre) --- */
  const As = t * (be2 + ceff);
  const Is = inertieRaidisseur(be2, ceff, t);

  /*
   * Raideur du ressort qui tient le raidisseur, § 5.5.3.1(5). En FLEXION, l'aile
   * opposée est tendue et ne participe pas : kf = 0, ce qui supprime le terme
   * croisé. L'employer quand même — formule de la compression pure — donnerait
   * un ressort plus souple et une pénalité imméritée.
   */
  const b1 = be2 + t / 2;
  const K = ((E * t ** 3) / (4 * (1 - NU * NU))) / (b1 * b1 * bpWeb + b1 ** 3);
  const sigmaCrS = As > 0 ? (2 * Math.sqrt(K * E * Is)) / As : Infinity;
  const lambdaD = Math.sqrt(fy / sigmaCrS);
  const chiD = chiDistorsion(lambdaD);

  /*
   * ⚠ La réduction s'applique en AMINCISSANT le raidisseur, § 5.5.3.1(10), et
   * non en raccourcissant ses parois : c'est sa rigidité qui manque, pas sa
   * matière. Le raccourcir déplacerait l'axe neutre du mauvais côté.
   */
  const tRed = t * chiD;

  /* --- 4. Âme sous gradient de contrainte --- */
  /*
   * ψ = −1 en flexion pure : une fibre comprimée d'un côté, tendue de l'autre.
   * kσ = 23,9 (tableau 4.1, paroi interne). L'âme d'une panne est élancée mais
   * à moitié tendue : elle reste souvent entièrement efficace, et c'est ce que
   * ce calcul doit pouvoir conclure plutôt que de l'amputer par principe.
   */
  const rhoWeb = rho(bpWeb / 2, t, epsilon, 23.9, -1);

  /* --- 5. Section efficace, recomposée en rectangles --- */
  const rects = rectsEfficaces(p, comprimee, { rhoFlange, rhoLip, rhoWeb, tRed });
  const props = flexion(rects);

  /*
   * ⚠ Module MINIMAL, § 6.1.4.1 : rapporté à la fibre la plus ÉLOIGNÉE du
   * centre de gravité, comprimée ou tendue. Le rapporter à la seule fibre
   * comprimée paraît naturel — c'est elle qui voile — mais la fibre tendue,
   * elle, est restée entière : si elle est plus éloignée, c'est elle qui atteint
   * fy la première et c'est donc elle qui gouverne.
   *
   * L'erreur ne se voyait que sur les Z, dont les ailes inégales décalent le
   * centre de gravité : le module « efficace » y ressortait jusqu'à 3 % AU-DESSUS
   * du module brut. Une section amputée plus résistante que la section pleine —
   * l'absurdité qui a servi de révélateur.
   */
  const zHaut = Math.max(...rects.map((r) => r.z1));
  const zBas = Math.min(...rects.map((r) => r.z0));
  const v = Math.max(zHaut - props.cz, props.cz - zBas);
  const Weff = props.Iy / v;

  const gouverne =
    chiD < 0.99
      ? `flambement par distorsion de la lèvre (χd = ${chiD.toFixed(2)})`
      : rhoFlange < 0.99
        ? `voilement local de l’aile comprimée (ρ = ${rhoFlange.toFixed(2)})`
        : rhoWeb < 0.99
          ? `voilement local de l’âme (ρ = ${rhoWeb.toFixed(2)})`
          : 'section entièrement efficace';

  return {
    Weff,
    McRd: (Weff * fy) / GAMMA_M0,
    Aeff: props.A,
    rendement: props.A / p.A,
    chiD,
    aileEfficace: beff,
    levreEfficace: ceff,
    gouverne,
  };
}

/**
 * Inertie du raidisseur de rive autour de son propre axe, parallèle à l'aile.
 *
 * Le raidisseur est la réunion de la part efficace de l'aile et de la lèvre :
 * un petit L dont il faut l'inertie propre, celle qui mesure sa raideur.
 */
function inertieRaidisseur(be2: number, ceff: number, t: number): number {
  if (be2 <= 0 || ceff <= 0) return 0;
  return flexion([
    rect(0, be2, 0, t), // part d'aile, couchée
    rect(be2 - t, be2, t, t + ceff), // lèvre, relevée
  ]).Iy;
}

/**
 * Aire, centre de gravité et inertie d'axe fort d'un jeu de rectangles disjoints.
 *
 * ⚠ Délibérément PLUS MAIGRE que `rectSetProps`, qui calcule en plus deux
 * modules plastiques par dichotomie. Ce module n'en a aucun usage — une section
 * formée à froid ne plastifie jamais — et les payer coûtait 0,3 ms par appel,
 * six cents fois le prix d'un moment résistant ordinaire. Sur le
 * dimensionnement automatique, qui parcourt tout le catalogue, cela ajoutait
 * vingt secondes.
 */
function flexion(rects: readonly Rect[]): { A: number; cz: number; Iy: number } {
  let A = 0;
  let sz = 0;
  for (const r of rects) {
    const a = (r.y1 - r.y0) * (r.z1 - r.z0);
    A += a;
    sz += a * ((r.z0 + r.z1) / 2);
  }
  if (A === 0) return { A: 0, cz: 0, Iy: 0 };
  const cz = sz / A;

  let Iy = 0;
  for (const r of rects) {
    const w = r.y1 - r.y0;
    const h = r.z1 - r.z0;
    const dz = (r.z0 + r.z1) / 2 - cz;
    Iy += (w * h ** 3) / 12 + w * h * dz * dz;
  }
  return { A, cz, Iy };
}

/**
 * Rectangles de la section efficace.
 *
 * ⚠ Ils doivent rester DISJOINTS, comme ceux de la section brute : un
 * recouvrement au droit d'un pli compterait la matière deux fois et gonflerait
 * le module efficace — c'est-à-dire exactement la grandeur qu'on cherche à
 * réduire.
 */
function rectsEfficaces(
  p: ColdProfile,
  comprimee: 'haute' | 'basse',
  e: { rhoFlange: number; rhoLip: number; rhoWeb: number; tRed: number },
): Rect[] {
  const { h, t, c } = p;
  const aileC = comprimee === 'haute' ? p.aile2 : p.aile;
  const aileT = comprimee === 'haute' ? p.aile : p.aile2;

  const out: Rect[] = [];

  /*
   * ⚠ RÈGLE DE RECOMPOSITION, valable pour toutes les parois qui suivent : les
   * coefficients de réduction se CALCULENT sur les largeurs planes notionnelles
   * — c'est ce qu'exige le code — mais s'APPLIQUENT aux dimensions brutes des
   * rectangles. Sans quoi une réduction nulle ne redonne pas la section brute :
   * la lèvre ressortait une demi-épaisseur trop longue et les deux morceaux
   * d'âme se recouvraient, si bien que le module « efficace » dépassait le
   * module brut. Une section amputée plus résistante que la section pleine :
   * l'absurdité qui a fait trouver le défaut.
   */

  /*
   * Âme : la moitié TENDUE reste entière — une paroi tendue ne voile pas.
   *
   * La moitié comprimée se partage 0,4 / 0,6 (tableau 4.1, paroi interne à
   * ψ = −1) : 40 % contre la fibre comprimée, 60 % contre l'axe neutre, et le
   * VIDE entre les deux. Poser la largeur efficace d'un seul tenant depuis
   * l'axe neutre enlèverait la matière la plus éloignée de l'axe, celle qui
   * porte le moment, et sous-estimerait le module.
   */
  const zMilieu = h / 2;
  const haute = comprimee === 'haute';
  out.push(haute ? rect(0, t, 0, zMilieu) : rect(0, t, zMilieu, h));

  const comprime = e.rhoWeb * (h / 2); // hauteur d'âme conservée
  const pres = 0.6 * comprime; // contre l'axe neutre
  const loin = 0.4 * comprime; // contre la fibre comprimée
  if (haute) {
    out.push(rect(0, t, zMilieu, zMilieu + pres));
    out.push(rect(0, t, h - loin, h));
  } else {
    out.push(rect(0, t, zMilieu - pres, zMilieu));
    out.push(rect(0, t, 0, loin));
  }

  /* Aile TENDUE et sa lèvre : entières, elles ne voilent pas. */
  const zT = comprimee === 'haute' ? 0 : h - t;
  out.push(rect(t, aileT, zT, zT + t));
  const zLevreT = comprimee === 'haute' ? t : h - c;
  out.push(rect(aileT - t, aileT, zLevreT, zLevreT + (c - t)));

  /*
   * Aile COMPRIMÉE : réduite à sa largeur efficace, et amincie sur la part qui
   * forme le raidisseur. Les deux moitiés efficaces se placent aux deux bords de
   * la paroi — la matière manquante est prise au MILIEU, là où la tôle se dérobe.
   */
  const z0 = comprimee === 'haute' ? h - t : 0;
  const demi = (e.rhoFlange * (aileC - t)) / 2;
  out.push(rect(t, t + demi, z0, z0 + t)); // moitié côté âme
  out.push(rect(aileC - demi, aileC, z0, z0 + t)); // moitié côté lèvre

  /* Lèvre comprimée : longueur efficace, épaisseur réduite par χd. */
  const levre = e.rhoLip * (c - t);
  const zLevre = comprimee === 'haute' ? h - t - levre : t;
  out.push(rect(aileC - e.tRed, aileC, zLevre, zLevre + levre));

  return out.filter((r) => r.y1 > r.y0 && r.z1 > r.z0);
}

/* ------------------------------------------------------------------ */
/* Semelle libre comprimée — EN 1993-1-3 § 10.1.4                      */
/* ------------------------------------------------------------------ */

export interface SemelleLibre {
  /** Rayon de giration latéral de la semelle libre (mm). */
  readonly ifz: number;
  /** Élancement réduit de la semelle libre. */
  readonly lambdaFz: number;
  /** Coefficient de réduction, courbe b. */
  readonly chiLT: number;
}

/**
 * Stabilité de la SEMELLE LIBRE comprimée, sous soulèvement.
 *
 * ⚠⚠ LE CAS QUI DIMENSIONNE SOUVENT UNE PANNE FORMÉE À FROID, et que le calcul
 * ignorait entièrement : un profil Z ou C n'était « pas sujet au déversement »,
 * son χLT valait 1, et une panne pouvait sortir vérifiée sous vent ascendant
 * sans que rien n'ait regardé l'aile basse. Or sous dépression, c'est elle qui
 * est comprimée — et elle n'est tenue par RIEN : le bac est fixé sur l'autre.
 *
 * Modèle du § 10.1.4 : la semelle libre, sa lèvre et le CINQUIÈME de la hauteur
 * d'âme qui la borde forment une barre comprimée, qui flambe latéralement entre
 * ses maintiens. On en tire λfz, puis χLT sur la courbe b.
 *
 * ⚠ DEUX SIMPLIFICATIONS, d'effet opposé, qu'il faut connaître :
 *  — AUCUN maintien n'est attribué au bac (le ressort K du § 10.1.4.1 est pris
 *    nul) et la longueur de flambement est la distance ENTIÈRE entre maintiens.
 *    C'est conservatif : la norme réduit cette longueur selon la raideur du bac.
 *  — la FLEXION LATÉRALE de la semelle libre (le terme Mfz du § 10.1.4.2), due à
 *    l'excentrement de la charge par rapport au centre de cisaillement, n'est
 *    PAS calculée. Cette omission-là n'est pas conservative : le rapport le dit
 *    sur chaque panne concernée, et renvoie aux tables du fabricant.
 */
export function semelleLibre(
  p: ColdProfile,
  fy: number,
  /** Distance entre maintiens latéraux de la semelle libre (mm). */
  lfz: number,
  aile: 'haute' | 'basse',
): SemelleLibre {
  const { t, c, h } = p;
  const b = aile === 'haute' ? p.aile2 : p.aile;
  const hAme = h / 5;
  // Repère local de la semelle : âme en y ∈ [0, t], semelle vers les y positifs.
  const rects = [
    rect(0, t, 0, hAme), // cinquième d'âme contigu à la semelle
    rect(t, b, 0, t), // semelle
    rect(b - t, b, t, c), // lèvre
  ];
  const { A, I } = inertieLaterale(rects);
  const ifz = Math.sqrt(I / A);

  const lambda1 = Math.PI * Math.sqrt(E / fy);
  const lambdaFz = lfz / ifz / lambda1;
  return { ifz, lambdaFz, chiLT: chiCourbeB(lambdaFz) };
}

/**
 * Coefficient de réduction sur la courbe b (α = 0,34).
 *
 * C'est la courbe que l'EN 1993-1-3 prescrit pour la semelle libre, quelle que
 * soit la forme : elle ne dépend pas, comme pour les laminés, du rapport h/b.
 */
function chiCourbeB(lambda: number): number {
  if (lambda <= 0.2) return 1;
  const phi = 0.5 * (1 + 0.34 * (lambda - 0.2) + lambda * lambda);
  return Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lambda * lambda)));
}

/** Aire et inertie autour de l'axe parallèle à l'âme, pour un jeu de rectangles. */
function inertieLaterale(rects: readonly Rect[]): { A: number; I: number } {
  let A = 0;
  let sy = 0;
  for (const r of rects) {
    const a = (r.y1 - r.y0) * (r.z1 - r.z0);
    A += a;
    sy += a * ((r.y0 + r.y1) / 2);
  }
  const cy = sy / A;
  let I = 0;
  for (const r of rects) {
    const w = r.y1 - r.y0;
    const hh = r.z1 - r.z0;
    const dy = (r.y0 + r.y1) / 2 - cy;
    I += (hh * w ** 3) / 12 + w * hh * dy * dy;
  }
  return { A, I };
}

/**
 * Hypothèses à porter dans la note de calcul dès qu'un profil formé à froid
 * figure dans l'ouvrage.
 *
 * ⚠ La note part chez des tiers : le contrôleur, le client, l'entreprise. Les
 * limites de la méthode doivent y être écrites, et non seulement affichées
 * panne par panne à l'écran — qui lit la note n'a pas l'écran sous les yeux.
 */
export function hypothesesFroid(profils: readonly string[]): string[] {
  const froids = [...new Set(profils)].filter((id) => /^[ZC] \d/.test(id));
  if (froids.length === 0) return [];
  return [
    `Profils formés à froid (${froids.join(', ')}) : dimensions représentatives du marché, à ` +
      'reprendre sur le catalogue du fabricant retenu. Résistance en flexion par la section ' +
      'efficace de l’EN 1993-1-3 § 5.5 (largeurs efficaces et flambement par distorsion des ' +
      'lèvres), jamais par la section brute.',
    'Sous soulèvement, stabilité de la semelle libre comprimée selon l’EN 1993-1-3 § 10.1.4 : ' +
      'semelle, lèvre et cinquième d’âme, courbe b, longueur entre liernes, SANS maintien attribué ' +
      'au bac (hypothèse prudente). Ne sont PAS vérifiés : la flexion latérale de la semelle libre, ' +
      'la résistance locale sur appui et la continuité par emboîtement — à justifier sur les ' +
      'tables du fabricant.',
  ];
}
