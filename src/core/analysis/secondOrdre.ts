import type { FrameAnalysisModel } from './frameModel';
import { solveFrame2d, type Frame2dInput, type Node2 } from './frame2d';

/**
 * IMPERFECTIONS D'APLOMB ET SENSIBILITÉ AU SECOND ORDRE.
 *
 * ⚠ Deux exigences de l'EN 1993-1-1 manquaient entièrement au calcul, et elles
 * vont ensemble :
 *
 *  - § 5.3.2 : un portique n'est jamais d'aplomb. Le défaut initial φ crée, sous
 *    charge verticale, un moment que le calcul au premier ordre ignore
 *    totalement. On le représente par des forces horizontales équivalentes φ·V.
 *    Sur un portique à pieds articulés, c'est loin d'être négligeable : elles
 *    ajoutent au genou un moment de quelques pour cent, et surtout elles
 *    EXISTENT même sous les combinaisons sans vent, où le portique était jusqu'ici
 *    parfaitement symétrique et donc parfaitement non déplaçable.
 *
 *  - § 5.2.1 : la souplesse d'ensemble amplifie ces mêmes effets. Le rapport αcr
 *    dit de combien. Le logiciel retenait à sa place un coefficient de longueur
 *    de flambement FORFAITAIRE — 2,0 sur pied articulé, 1,5 sur pied encastré —
 *    en le déclarant « l'hypothèse la plus lourde de tout le module ». Elle
 *    pénalisait lourdement les portiques raides et ne disait rien des souples.
 */

/** Défaut d'aplomb de référence, EN 1993-1-1 § 5.3.2(3). */
const PHI_0 = 1 / 200;

export interface SensibiliteSecondOrdre {
  /** Rapport de charge critique de l'ossature. */
  readonly alphaCr: number;
  /** Défaut d'aplomb retenu (radians). */
  readonly phi: number;
  /**
   * Facteur d'amplification des effets de déplacement latéral : 1/(1 − 1/αcr)
   * pour une ossature `souple`, 1 sinon — y compris `instable`, où aucun facteur
   * n'est valable et où les efforts restent ceux du premier ordre.
   */
  readonly amplification: number;
  /**
   * Classement de l'ossature :
   *  - `rigide`   : αcr ≥ 10, le second ordre est négligeable ;
   *  - `souple`   : 3 ≤ αcr < 10, effets amplifiés, calcul encore valable ;
   *  - `instable` : αcr < 3, l'EN 1993-1-1 exige une analyse au second ordre
   *    complète, que SteelPlan ne fait pas : la vérification est hors domaine.
   */
  readonly classe: 'rigide' | 'souple' | 'instable';
}

/**
 * Défaut d'aplomb d'un portique, réductions comprises.
 *
 * ⚠ Les deux réductions de la norme ne sont PAS optionnelles et changent le
 * résultat d'un tiers : αh décroît avec la hauteur — un bâtiment haut est plus
 * difficile à bâtir de travers sur toute sa hauteur — et αm avec le nombre de
 * files, les défauts de plusieurs poteaux ne se cumulant pas tous dans le même
 * sens. Retenir φ0 brut surestimerait les moments d'imperfection de 40 % sur un
 * portique courant.
 */
export function defautAplomb(hauteur: number, nPoteaux: number): number {
  const h = Math.max(0.001, hauteur / 1000); // en mètres
  const alphaH = Math.min(1, Math.max(2 / 3, 2 / Math.sqrt(h)));
  const m = Math.max(1, nPoteaux);
  const alphaM = Math.sqrt(0.5 * (1 + 1 / m));
  return PHI_0 * alphaH * alphaM;
}

/**
 * Forces horizontales équivalentes au défaut d'aplomb.
 *
 * ⚠ Elles ne sont PAS une charge de plus : elles remplacent une géométrie
 * inclinée par une géométrie droite chargée horizontalement, ce qui donne le
 * même moment. Leur signe suit celui de la charge de vent quand il y en a une —
 * l'imperfection se met toujours du côté le plus défavorable — et se prend
 * arbitrairement positif sinon, la symétrie du portique rendant les deux
 * équivalents.
 */
export function forcesImperfection(
  fm: FrameAnalysisModel,
  input: Frame2dInput,
  sens: number,
): Map<number, readonly [number, number, number]> {
  const { vertical, tetes, hauteur } = descenteEtTetes(fm, input);
  if (vertical <= 0 || tetes.length === 0) return new Map(input.nodalLoads);

  const phi = defautAplomb(hauteur, tetes.length);
  const h = (phi * vertical * (sens >= 0 ? 1 : -1)) / tetes.length;

  const out = new Map(input.nodalLoads);
  for (const n of tetes) {
    const actuel = out.get(n) ?? ([0, 0, 0] as const);
    out.set(n, [actuel[0] + h, actuel[1], actuel[2]]);
  }
  return out;
}

/**
 * Sensibilité au second ordre, EN 1993-1-1 § 5.2.1(4)B.
 *
 * αcr = (H / V) × (h / δ), mesuré sous un cas de charge HORIZONTAL auxiliaire.
 * On emploie précisément les forces d'imperfection : elles sont proportionnelles
 * à V, donc le rapport ne dépend pas de leur intensité, et elles ont l'allure du
 * mode de déplacement latéral qu'on cherche à caractériser.
 */
export function sensibilite(
  fm: FrameAnalysisModel,
  input: Frame2dInput,
): SensibiliteSecondOrdre {
  const { vertical, tetes, hauteur } = descenteEtTetes(fm, input);
  const phi = defautAplomb(hauteur, Math.max(1, tetes.length));

  if (vertical <= 0 || tetes.length === 0 || hauteur <= 0) {
    return { alphaCr: Infinity, phi, amplification: 1, classe: 'rigide' };
  }

  // Cas auxiliaire : la structure nue, poussée par les seules forces horizontales.
  const horizontal = phi * vertical;
  const auxiliaire: Frame2dInput = {
    nodes: input.nodes,
    elements: input.elements.map((e) => ({ ...e, qPerp: 0, qAxial: 0 })),
    supports: input.supports,
    nodalLoads: new Map(
      tetes.map((n) => [n, [horizontal / tetes.length, 0, 0] as const]),
    ),
  };

  let delta = 0;
  try {
    const res = solveFrame2d(auxiliaire);
    for (const n of tetes) {
      // Déplacement horizontal du nœud : premier degré de liberté du nœud.
      delta = Math.max(delta, Math.abs(res.d[3 * n] ?? 0));
    }
  } catch {
    // Ossature insoluble : on ne peut rien affirmer sur sa raideur.
    return { alphaCr: 0, phi, amplification: 1, classe: 'instable' };
  }

  if (delta <= 1e-9) {
    return { alphaCr: Infinity, phi, amplification: 1, classe: 'rigide' };
  }

  const alphaCr = (horizontal / vertical) * (hauteur / delta);
  return { alphaCr, phi, ...classer(alphaCr) };
}

/**
 * Classement d'une ossature et facteur d'amplification, d'après son αcr.
 *
 * ⚠ L'amplification ne s'applique que pour 3 ≤ αcr < 10 (EN 1993-1-1
 * § 5.2.2(6)B). Au-dessus, le second ordre est négligeable et l'appliquer serait
 * du sur-dimensionnement gratuit ; en dessous, la formule diverge et la norme
 * exige un vrai calcul au second ordre — dont l'absence doit être DITE, pas
 * compensée par un facteur qui n'a plus de sens. Les efforts y restent donc
 * ceux du premier ordre, et le rapport déclare la vérification hors domaine.
 */
export function classer(alphaCr: number): Pick<SensibiliteSecondOrdre, 'amplification' | 'classe'> {
  if (alphaCr >= 10) return { amplification: 1, classe: 'rigide' };
  if (alphaCr >= 3) return { amplification: 1 / (1 - 1 / alphaCr), classe: 'souple' };
  return { amplification: 1, classe: 'instable' };
}

/* ------------------------------------------------------------------ */

/**
 * Charge verticale totale, nœuds de tête et hauteur d'étage.
 *
 * Les « têtes » sont les nœuds qui reçoivent les forces d'imperfection : le haut
 * des poteaux, c'est-à-dire les nœuds les plus hauts de chaque file verticale
 * appuyée. Les appliquer au faîtage donnerait un mode de déplacement qui n'est
 * pas celui du portique.
 */
function descenteEtTetes(
  fm: FrameAnalysisModel,
  input: Frame2dInput,
): { vertical: number; tetes: number[]; hauteur: number } {
  // Charge verticale totale = somme des charges réparties projetées sur z.
  let vertical = 0;
  for (const e of input.elements) {
    const A = fm.nodes[e.a] as Node2 | undefined;
    const B = fm.nodes[e.b] as Node2 | undefined;
    if (!A || !B) continue;
    const L = Math.hypot(B.y - A.y, B.z - A.z);
    const c = L > 0 ? (B.y - A.y) / L : 1;
    const s = L > 0 ? (B.z - A.z) / L : 0;
    // Retour au repère global : z global = qAxial·s + qPerp·c.
    vertical += -(e.qAxial * s + e.qPerp * c) * L;
  }

  const appuis = [...input.supports.keys()];
  const zAppui = appuis.length > 0 ? Math.min(...appuis.map((i) => fm.nodes[i]?.z ?? 0)) : 0;

  /*
   * Les têtes de poteaux : pour chaque appui, le nœud le plus haut qui partage
   * son abscisse transversale. C'est la définition géométrique du sommet d'un
   * poteau, et elle vaut aussi bien pour un portique que pour une ferme sur
   * poteaux.
   */
  const tetes: number[] = [];
  let hauteur = 0;
  for (const i of appuis) {
    const yA = fm.nodes[i]?.y ?? 0;
    let meilleur = i;
    let zMax = fm.nodes[i]?.z ?? 0;
    for (const [j, n] of fm.nodes.entries()) {
      if (Math.abs(n.y - yA) > 1) continue;
      if (n.z > zMax) {
        zMax = n.z;
        meilleur = j;
      }
    }
    if (meilleur !== i) {
      tetes.push(meilleur);
      hauteur = Math.max(hauteur, zMax - zAppui);
    }
  }
  return { vertical, tetes, hauteur };
}
