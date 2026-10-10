import { getProfile } from '../catalog/index';
import type { StructuralModel } from '../build/types';
import { cutLengths, type MemberRole } from '../geometry/member';
import { frameStations, roofArea, roofNormal, roofSide } from '../model/grid';
import { ventSurPortique, type VentSurPortique } from '../climat/zonesVent';
import type { ProjectParams } from '../model/project';
import type { Element2, Frame2dInput, Node2, Support } from './frame2d';
import { APPUI_ENCASTRE, APPUI_ROTULE } from './frame2d';
import type { ActionId, ActionIntensities, Combination } from './loadCases';
import { forcesImperfection } from './secondOrdre';

/**
 * MODÈLE DE CALCUL, EXTRAIT DU MODÈLE DE CONSTRUCTION.
 *
 * ⚠ Choix d'architecture. Le modèle de calcul n'est pas une seconde description
 * du bâtiment : il est PROJETÉ depuis le `StructuralModel`, exactement comme la
 * vue 3D et les plans. On récupère les barres qui vivent dans le plan d'un
 * portique, on fusionne leurs abouts en nœuds, et on calcule.
 *
 * La conséquence est décisive : un treillis se calcule sans une ligne de plus
 * qu'un portique à âme pleine, puisque ce sont les mêmes barres extraites de la
 * même façon. Et aucune divergence n'est possible entre ce qu'on dessine et ce
 * qu'on vérifie — modifier un profil dans l'interface modifie le calcul, sans
 * qu'aucun code ne fasse le lien.
 *
 * Unités : N, mm.
 */

const E_ACIER = 210_000; // N/mm²

/** Rôles qui appartiennent au plan d'un portique. */
const ROLES_PORTIQUE: readonly MemberRole[] = [
  'poteau',
  'traverse',
  // Le porte-à-faux de rive : sans lui, le portique perdrait la charge du débord.
  'console',
  'membrure-sup',
  'membrure-inf',
  'montant',
  'diagonale',
];

/** Rôles qui reçoivent directement la charge de toiture. */
const ROLES_TOITURE: readonly MemberRole[] = ['traverse', 'console', 'membrure-sup'];

/**
 * Rôles articulés à leurs deux abouts : les barres de triangulation.
 *
 * Les MEMBRURES n'y figurent pas : elles sont d'un seul tenant sur toute la
 * portée et restent continues, ce qui est à la fois la réalité de la pièce et ce
 * qui tient la stabilité de rotation des nœuds du treillis.
 */
const ROLES_ARTICULES: readonly MemberRole[] = ['montant', 'diagonale'];

/** Un segment du modèle de calcul, rattaché à la barre dont il vient. */
export interface Segment {
  readonly memberId: string;
  readonly role: MemberRole;
  readonly profileId: string;
  readonly grade: string;
  /** Nœuds d'extrémité dans le modèle de calcul. */
  readonly a: number;
  readonly b: number;
  readonly L: number;
  /** Cosinus directeurs dans le plan (y, z). */
  readonly c: number;
  readonly s: number;
  /** Barre articulée à ses abouts : voir `ROLES_ARTICULES`. */
  readonly articule: boolean;
  /**
   * Part de la charge de surface que ce segment reprend : 1 s'il est seul,
   * 1/2 s'il forme une paire dos à dos, etc.
   *
   * ⚠ Sans cela, une ferme en cornières jumelées reçoit DEUX FOIS la charge de
   * toiture : les deux cornières d'une paire occupent la même position, et
   * chacune se voyait attribuer la bande de toiture entière. Le treillis était
   * alors dimensionné pour le double de la charge réelle — une erreur invisible,
   * puisque tous les efforts restent en équilibre entre eux.
   *
   * Le poids propre, lui, ne se divise pas : les deux cornières existent
   * réellement et pèsent chacune leur poids.
   */
  readonly partDeCharge: number;
}

export interface FrameAnalysisModel {
  readonly nodes: readonly Node2[];
  readonly segments: readonly Segment[];
  readonly supports: ReadonlyMap<number, Support>;
  /** Abscisse du portique extrait (mm) et largeur reprise (mm). */
  readonly x: number;
  readonly tributary: number;
  /** Nœuds d'about de chaque barre, pour lire les flèches sur sa corde. */
  readonly memberEnds: ReadonlyMap<string, readonly [number, number]>;
  /**
   * Plus grande distance entre deux nœuds de STRUCTURE consécutifs sur une barre
   * (mm) — la « longueur de maille ».
   *
   * ⚠ À ne pas confondre avec la longueur de la barre. Une membrure de treillis
   * de 18 m est reliée aux diagonales tous les 2,25 m : c'est cette distance qui
   * gouverne son flambement, pas les 18 m. Les nœuds de subdivision, ajoutés pour
   * lire les flèches, ne comptent pas — ils ne tiennent rien.
   */
  readonly memberPanelLength: ReadonlyMap<string, number>;
}

/* ------------------------------------------------------------------ */

/** Portique courant : celui du milieu, qui reprend une travée entière. */
export function currentFrameX(p: ProjectParams): number {
  const files = frameStations(p.grid);
  if (files.length <= 2) return files[0] ?? 0;
  return files[Math.floor(files.length / 2)] as number;
}

/**
 * Poids de l'ossature secondaire ramené au m² de toiture (kN/m²).
 *
 * Cette valeur n'est pas saisie : les pannes existent dans le modèle, leur masse
 * est connue. La demander à l'utilisateur serait lui faire ressaisir une donnée
 * que le logiciel possède — et donc autoriser un écart entre les deux.
 */
export function secondaryLoadKnM2(p: ProjectParams, model: StructuralModel): number {
  const aire = roofArea(p.grid);
  if (aire <= 0) return 0;

  let kg = 0;
  for (const m of model.members) {
    if (m.role === 'panne' || m.role === 'lierne') {
      kg += (getProfile(m.profileId).G * cutLengths(m).axis) / 1000;
    }
  }
  return (kg * 9.81) / 1000 / aire;
}

/* ------------------------------------------------------------------ */

/**
 * Extraction du modèle de calcul d'un portique.
 *
 * Les barres sont subdivisées : non pas pour les efforts — le moment
 * parabolique d'une charge répartie est exact dans un seul élément — mais pour
 * les FLÈCHES, qu'on lit sur les déplacements des nœuds intermédiaires. C'est
 * plus sûr que d'intégrer la déformée à la main.
 */
export function buildFrameModel(
  p: ProjectParams,
  model: StructuralModel,
  x = currentFrameX(p),
): FrameAnalysisModel {
  const tol = 5; // mm : deux abouts plus proches que cela sont le même nœud
  // ⚠ Les barres d'un treillis en cornières vont par paires dos à dos, décalées
  // de quelques dizaines de millimètres de part et d'autre du plan du portique.
  // Exiger x exactement égal les exclurait toutes. On demande donc une barre
  // PARALLÈLE au plan et proche de lui ; les deux cornières d'une paire se
  // rabattent alors sur les mêmes nœuds, ce qui est physiquement correct — elles
  // travaillent ensemble et chacune reçoit sa part de l'effort.
  const horsPlan = 250; // mm
  const barres = model.members.filter(
    (m) =>
      ROLES_PORTIQUE.includes(m.role) &&
      Math.abs(m.start.x - m.end.x) < tol &&
      Math.abs((m.start.x + m.end.x) / 2 - x) < horsPlan,
  );

  const nodes: Node2[] = [];
  const trouver = (y: number, z: number): number => {
    const i = nodes.findIndex((n) => Math.abs(n.y - y) < tol && Math.abs(n.z - z) < tol);
    if (i >= 0) return i;
    nodes.push({ y, z });
    return nodes.length - 1;
  };

  // Abouts d'abord : la fusion doit porter sur les vrais nœuds de structure,
  // avant toute subdivision, sinon deux barres concourantes ne se voient pas.
  const abouts = new Map<string, readonly [number, number]>();
  for (const m of barres) {
    abouts.set(m.id, [trouver(m.start.y, m.start.z), trouver(m.end.y, m.end.z)]);
  }

  // Nœuds en T. ⚠ Sans cette étape le modèle est FAUX et non simplement
  // approché : la traverse d'un portique passe À TRAVERS le sommet du poteau —
  // elle démarre au débord de rive et ne s'y arrête pas. Le sommet du poteau
  // n'est donc l'about d'aucune traverse, et les deux barres restent
  // désolidarisées. Le portique devient alors un mécanisme : deux consoles
  // verticales et une traverse flottante.
  const abscissesForcees = new Map<string, number[]>();
  const mailles = new Map<string, number>();
  for (const m of barres) {
    const [na, nb] = abouts.get(m.id) as readonly [number, number];
    const A = nodes[na] as Node2;
    const B = nodes[nb] as Node2;
    const dy = B.y - A.y;
    const dz = B.z - A.z;
    const L2 = dy * dy + dz * dz;
    if (L2 < tol * tol) continue;

    const ts: number[] = [];
    for (const [i, n] of nodes.entries()) {
      if (i === na || i === nb) continue;
      const t = ((n.y - A.y) * dy + (n.z - A.z) * dz) / L2;
      if (t <= 0 || t >= 1) continue;
      // Distance du nœud à l'axe de la barre : il faut qu'il soit DESSUS.
      const ecart = Math.hypot(A.y + dy * t - n.y, A.z + dz * t - n.z);
      if (ecart < tol) ts.push(t);
    }
    const triees = ts.sort((a, b) => a - b);
    abscissesForcees.set(m.id, triees);

    // Longueur de maille : le plus grand intervalle entre deux nœuds tenus.
    const bornes = [0, ...triees, 1];
    let maille = 0;
    for (let i = 1; i < bornes.length; i++) {
      maille = Math.max(maille, (bornes[i] as number) - (bornes[i - 1] as number));
    }
    mailles.set(m.id, maille * Math.sqrt(L2));
  }

  const segments: Segment[] = [];
  for (const m of barres) {
    const [na, nb] = abouts.get(m.id) as readonly [number, number];
    const A = nodes[na] as Node2;
    const B = nodes[nb] as Node2;
    const L = Math.hypot(B.y - A.y, B.z - A.z);
    if (L < tol) continue;

    // Coupures imposées par les nœuds en T, complétées par une subdivision
    // régulière : les efforts n'en ont pas besoin, les flèches si.
    //
    // ⚠ Une barre ARTICULÉE ne se subdivise PAS. Deux tronçons articulés
    // colinéaires laissent leur nœud commun sans aucune raideur — ni de rotation,
    // ni transversale — et le système devient singulier. Le rapport se vidait
    // alors en silence de toutes les barres du portique. Une barre de
    // triangulation n'a de toute façon pas de flèche à lire : elle ne porte
    // qu'un effort normal.
    const articule = ROLES_ARTICULES.includes(m.role);
    const forcees = abscissesForcees.get(m.id) ?? [];
    const coupures = new Set<number>([0, 1, ...forcees]);
    if (!articule) {
      const n = Math.min(8, Math.max(1, Math.round(L / 1200)));
      for (let i = 1; i < n; i++) coupures.add(i / n);
    }
    const triees = [...coupures].sort((a, b) => a - b);

    for (let i = 1; i < triees.length; i++) {
      const t0 = triees[i - 1] as number;
      const t1 = triees[i] as number;
      const na2 = t0 === 0 ? na : trouver(A.y + (B.y - A.y) * t0, A.z + (B.z - A.z) * t0);
      const nb2 = t1 === 1 ? nb : trouver(A.y + (B.y - A.y) * t1, A.z + (B.z - A.z) * t1);
      const P = nodes[na2] as Node2;
      const Q = nodes[nb2] as Node2;
      const l = Math.hypot(Q.y - P.y, Q.z - P.z);
      if (l < tol) continue;
      segments.push({
        memberId: m.id,
        role: m.role,
        profileId: m.profileId,
        grade: m.grade,
        a: na2,
        b: nb2,
        L: l,
        c: (Q.y - P.y) / l,
        s: (Q.z - P.z) / l,
        articule,
        partDeCharge: 1, // corrigé juste après, une fois les paires connues
      });
    }
  }

  // Paires dos à dos : plusieurs barres du même rôle entre les mêmes deux nœuds
  // sont une seule position de la structure, et se partagent la bande de charge.
  const occupants = new Map<string, number>();
  const cle = (seg: Segment): string =>
    `${Math.min(seg.a, seg.b)}-${Math.max(seg.a, seg.b)}-${seg.role}`;
  for (const seg of segments) occupants.set(cle(seg), (occupants.get(cle(seg)) ?? 0) + 1);
  const partages = segments.map((seg) => ({
    ...seg,
    partDeCharge: 1 / (occupants.get(cle(seg)) ?? 1),
  }));

  // Appuis : les pieds de poteaux, reconnus à leur altitude nulle.
  const appui = p.frame.baseFixity === 'encastre' ? APPUI_ENCASTRE : APPUI_ROTULE;
  const supports = new Map<number, Support>();
  for (const [i, n] of nodes.entries()) {
    if (Math.abs(n.z) < tol && estPiedDeBarre(i, partages)) supports.set(i, appui);
  }

  return {
    nodes,
    segments: partages,
    supports,
    x,
    tributary: p.grid.baySpacing,
    memberEnds: abouts,
    memberPanelLength: mailles,
  };
}

/** Un nœud au sol n'est un pied que si une barre y aboutit. */
function estPiedDeBarre(i: number, segments: readonly Segment[]): boolean {
  return segments.some((s) => s.a === i || s.b === i);
}

/* ------------------------------------------------------------------ */
/* Chargement                                                          */
/* ------------------------------------------------------------------ */

/**
 * Charges appliquées à un segment pour une combinaison donnée.
 *
 * ⚠ Surfaces de référence. Une charge donnée par m² de rampant se répartit sur
 * la longueur de la barre ; une charge donnée par m² de projection horizontale
 * se répartit sur la projection, donc sa densité linéique le long d'un rampant
 * est multipliée par cos α. Confondre les deux fausse la neige de 5 à 15 % selon
 * la pente — dans le sens de la sous-estimation.
 */
export function chargerModele(
  fm: FrameAnalysisModel,
  p: ProjectParams,
  q: ActionIntensities,
  comb: Combination,
): Frame2dInput {
  const g = (a: ActionId): number => comb.factors[a] ?? 0;
  const b = fm.tributary; // largeur reprise (mm)
  const sens = comb.windDirection;
  // Vent par zones : coefficients nets de la bande que reprend CE portique.
  const zones = comb.vent && q.qp > 0 && g('W') !== 0 ? ventSurPortique(p.grid, comb.vent, ...bandeReprise(fm, p)) : null;

  const elements: Element2[] = fm.segments.map((seg) => {
    const profil = getProfile(seg.profileId);
    // Bande de toiture ou de façade effectivement reprise par CE segment.
    const bande = b * seg.partDeCharge;
    let vy = 0; // charge linéique globale selon y (N/mm)
    let vz = 0; // selon z (N/mm), négatif vers le bas

    // Poids propre de la barre elle-même.
    if (p.loads.loads.includeSelfWeight) {
      vz -= g('G') * ((profil.G * 9.81) / 1000);
    }

    if (ROLES_TOITURE.includes(seg.role)) {
      const cosA = Math.abs(seg.c); // cos de la pente du rampant
      // Par m² de rampant → densité linéique directe.
      vz -= (g('G') * q.gToit * bande) / 1000;
      // Par m² de projection horizontale → × cos α le long du rampant.
      const neige = g('S') * q.sToit * facteurDeNeige(comb, roofSide(p.grid, milieuY(fm, seg)));
      vz -= ((g('Q') * q.qToit + neige + g('Sacc') * q.sAccToit) * bande * cosA) / 1000;
      if (zones) {
        // Coefficient net du tronçon de toiture que couvre la barre ; positif,
        // il presse vers l'intérieur, donc à l'opposé de la normale extérieure.
        const n = roofNormal(p.grid, milieuY(fm, seg));
        const c = zones.toit((fm.nodes[seg.a] as Node2).y, (fm.nodes[seg.b] as Node2).y);
        const intensite = (g('W') * q.qp * c * bande) / 1000;
        vy -= n.y * intensite;
        vz -= n.z * intensite;
      } else if (g('W') !== 0 && q.wToit > 0) {
        // Dépression saisie : perpendiculaire au rampant, dirigée vers l'extérieur.
        const n = roofNormal(p.grid, milieuY(fm, seg));
        const intensite = (g('W') * q.wToit * bande) / 1000;
        vy += n.y * intensite;
        vz += n.z * intensite;
      }
    }

    if (seg.role === 'poteau' && zones) {
      // Les DEUX long-pans : pression au vent, succion sous le vent — toutes
      // deux poussent le portique dans le sens du vent.
      vy += (g('W') * q.qp * murDuPoteau(fm, seg, zones) * bande) / 1000;
    } else if (seg.role === 'poteau' && g('W') !== 0 && q.wMur > 0) {
      // Pression sur la façade au vent seulement : le poteau sous le vent est
      // vérifié par l'autre sens de vent, qui le met à son tour au vent.
      const auVent = sens > 0 ? estPoteauGauche(fm, seg) : !estPoteauGauche(fm, seg);
      if (auVent) vy += sens * ((g('W') * q.wMur * bande) / 1000);
    }

    // Projection dans le repère local : x le long de la barre, z tel que
    // (x, z) soit direct — z local = (−s, c).
    const qAxial = vy * seg.c + vz * seg.s;
    const qPerp = -vy * seg.s + vz * seg.c;

    return {
      a: seg.a,
      b: seg.b,
      A: profil.A,
      I: profil.Iy,
      E: E_ACIER,
      qPerp,
      qAxial,
      // L'articulation vient du SEGMENT et non du rôle relu ici : c'est la même
      // décision qui a interdit la subdivision, et les deux doivent coïncider.
      articule: seg.articule,
    };
  });

  const brut: Frame2dInput = {
    nodes: fm.nodes,
    elements,
    supports: fm.supports,
    nodalLoads: new Map(),
  };

  /*
   * ⚠ IMPERFECTION D'APLOMB, EN 1993-1-1 § 5.3.2. Elle manquait entièrement.
   * Un portique n'est jamais construit droit : le défaut initial φ crée, sous la
   * seule charge verticale, un moment que le premier ordre ignore. Sans elle, une
   * combinaison purement gravitaire sur un portique symétrique donnait un
   * déplacement latéral RIGOUREUSEMENT NUL — ce qu'aucun bâtiment ne fait.
   */
  return { ...brut, nodalLoads: forcesImperfection(fm, brut, sens) };
}

/**
 * Bande du bâtiment, le long des files (mm depuis le pignon), dont le portique
 * reçoit le vent. Le portique de RIVE reprend la demi-travée contre le pignon ;
 * le portique COURANT représente toutes les files intérieures, on lui donne la
 * plus exposée — la première, que touchent encore les zones de rive.
 */
function bandeReprise(fm: FrameAnalysisModel, p: ProjectParams): [number, number] {
  const t = p.grid.baySpacing;
  return fm.tributary < t - 1 ? [0, fm.tributary] : [t / 2, (3 * t) / 2];
}

/** Coefficient net du long-pan d'un poteau, compté positif vers les y croissants. */
function murDuPoteau(fm: FrameAnalysisModel, seg: Segment, zones: VentSurPortique): number {
  // Une pression (coefficient positif) presse vers l'intérieur : vers +y à
  // gauche, vers −y à droite.
  return estPoteauGauche(fm, seg) ? zones.murGauche : -zones.murDroit;
}

/** Part de la neige que reçoit un versant : la moitié sur le versant réduit. */
function facteurDeNeige(comb: Combination, versant: 'gauche' | 'droite'): number {
  if (comb.neige === 'reduitGauche') return versant === 'gauche' ? 0.5 : 1;
  if (comb.neige === 'reduitDroite') return versant === 'droite' ? 0.5 : 1;
  return 1;
}

function milieuY(fm: FrameAnalysisModel, seg: Segment): number {
  const A = fm.nodes[seg.a] as Node2;
  const B = fm.nodes[seg.b] as Node2;
  return (A.y + B.y) / 2;
}

/** Le poteau est-il du côté des y faibles ? */
function estPoteauGauche(fm: FrameAnalysisModel, seg: Segment): boolean {
  const yMax = Math.max(...fm.nodes.map((n) => n.y));
  const yMin = Math.min(...fm.nodes.map((n) => n.y));
  return milieuY(fm, seg) < (yMin + yMax) / 2;
}
