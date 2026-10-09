import { getProfile } from '../../catalog/index';
import type { StructuralModel } from '../../build/types';
import type { Member, MemberRole } from '../../geometry/member';
import { v3 } from '../../math/vec3';
import { buildingLength, frameStations } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { coteLineaire } from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { choisirEchelle } from '../scale';
import { DrawScene, pt, unionBbox, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { elementsAFabriquer } from './element';
import { appliquer, cadrer, project, VUE_LONG_PAN, VUE_PLAN, VUE_TRANSVERSALE, type Transform2D, type ViewDir } from '../view';
import { silhouette } from './ensemble';
import {
  bulleDAxe,
  etiquetteDeBarre,
  poserEtiquettes,
  tracerBarre,
  tracerJarret,
  tracerSection,
  vueEnBout,
  type Etiquette,
} from './reperageVues';

/**
 * PLAN DE REPÉRAGE ET DE MONTAGE.
 *
 * ⚠ Le dossier avait des plans d'ensemble et des plans d'atelier, et rien entre
 * les deux. L'atelier sait fabriquer TR1 ; le chantier reçoit six pièces
 * marquées TR1 et doit savoir LAQUELLE va où — et surtout dans quel ORDRE
 * monter. Sans ce plan, le monteur ouvre les plans d'ensemble et compte les
 * files à la main, ce qui est exactement le genre de comptage dont on se trompe
 * une fois sur dix.
 *
 * Deux différences avec les plans d'ensemble, et elles font tout :
 *  - CHAQUE pièce porte son repère, pas une par repère. C'est le contraire du
 *    plan d'ensemble, qui repère un exemplaire pour identifier une famille ;
 *  - l'ordre de levage est donné, phase par phase.
 */

export interface MontageOptions {
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}


/**
 * Phases de levage, dans l'ordre où la grue les prend.
 *
 * ⚠ Les contreventements viennent AVANT l'ossature secondaire, et ce n'est pas
 * un détail d'ordonnancement : tant qu'une travée n'est pas contreventée, elle
 * ne tient que par la grue. Poser les pannes d'abord revient à charger une
 * structure qui n'est pas encore stable.
 */
const PHASES: readonly { readonly titre: string; readonly roles: readonly MemberRole[] }[] = [
  { titre: '1 — Poteaux et potelets', roles: ['poteau', 'potelet'] },
  {
    titre: '2 — Traverses et fermes',
    roles: ['traverse', 'console', 'jarret', 'membrure-sup', 'membrure-inf', 'montant', 'diagonale'],
  },
  { titre: '3 — Contreventements (avant de libérer la grue)', roles: ['contreventement'] },
  { titre: '4 — Pannes, lisses et liernes', roles: ['panne', 'lisse', 'lierne', 'attache', 'equerre'] },
  { titre: '5 — Pièces ajoutées au projet', roles: ['libre'] },
];


export function sheetsMontage(
  model: StructuralModel,
  p: ProjectParams,
  opts: MontageOptions,
): Sheet[] {
  const L = buildingLength(p.grid);
  const g = p.grid;
  const hors = getProfile(p.frame.columnProfile).h / 2 + getProfile(p.secondary.rails.profile).h + 900;
  /*
   * ⚠ UNE VUE PAR FAÇADE. L'élévation projetait tout le bâtiment sur un seul
   * plan : les deux long-pans s'y superposaient, et le monteur ne savait pas de
   * quel côté était la palée qu'il lisait.
   */
  const pres = (axe: 'x' | 'y', valeur: number) => (m: Member): boolean =>
    Math.abs(m.start[axe] - valeur) < hors && Math.abs(m.end[axe] - valeur) < hors;
  const planches: Sheet[] = [
    toiture(model, p, { ...opts, page: opts.page }),
    facade(model, p, 'Plan de repérage — long pan avant', 'montage-avant', VUE_LONG_PAN, pres('y', 0), 'files', { ...opts, page: opts.page + 1 }),
    facade(model, p, 'Plan de repérage — long pan arrière', 'montage-arriere', VUE_ARRIERE, pres('y', g.span), 'files', { ...opts, page: opts.page + 2 }),
    pignons(model, p, pres('x', 0), pres('x', L), { ...opts, page: opts.page + 3 }),
    ordre(model, { ...opts, page: opts.page + 4 }),
  ];
  return planches;
}

/** Long pan arrière vu de l'extérieur : on regarde vers les y décroissants. */
const VUE_ARRIERE: ViewDir = { origin: v3(0, 0, 0), right: v3(-1, 0, 0), up: v3(0, 0, 1) };
/** Pignon ouest vu de l'extérieur : vers les x croissants. */
const VUE_OUEST: ViewDir = { origin: v3(0, 0, 0), right: v3(0, -1, 0), up: v3(0, 0, 1) };

/**
 * Format de la planche : l'A3 du dossier, ou l'A2 quand il permet de passer au
 * 1:100. ⚠ Au 1:200, un plan de repérage d'une halle de 20 m tient dans un
 * tiers de A3, et ses quatre-vingts repères s'y serrent ; le chantier lit un A2.
 */
function meilleurFormat(echelleSur: (f: SheetFormat) => number): SheetFormat {
  const a3 = echelleSur('A3');
  if (a3 <= 100) return 'A3';
  return echelleSur('A2') < a3 ? 'A2' : 'A3';
}

/** Marge papier autour d'une vue, pour les étiquettes et les axes (mm). */
const MARGE_VUE = 18;

/** Échelle et cadrage d'une vue sur sa zone, marges d'étiquetage comprises. */
function cadrerVue(membres: readonly Member[], v: ViewDir, zone: Bbox): { t: Transform2D; echelle: number } {
  const e = emprise(membres, v);
  const interieur: Bbox = { min: pt(zone.min.x + MARGE_VUE, zone.min.y + MARGE_VUE + 8), max: pt(zone.max.x - MARGE_VUE, zone.max.y - MARGE_VUE) };
  const echelle = choisirEchelle(e, interieur, 1.02);
  return { t: cadrer(e, interieur, echelle), echelle };
}

const PRINCIPAL: readonly MemberRole[] = ['poteau', 'traverse', 'console', 'potelet', 'membrure-sup', 'membrure-inf', 'contreventement', 'chevetre'];

/** Étiquette de chaque pièce dessinée — repère d'ASSEMBLAGE : c'est lui que porte la pièce livrée. */
function etiquetter(s: DrawScene, t: Transform2D, v: ViewDir, membres: readonly Member[], occupe: Bbox[], zone: Bbox): void {
  const etiquettes: Etiquette[] = [];
  // Les pièces principales d'abord : ce sont elles que le monteur cherche, et
  // elles prennent leur place avant les pannes et les lisses.
  const rang = (m: Member): number => (PRINCIPAL.includes(m.role) ? 0 : 1);
  for (const m of [...membres].sort((a, b) => rang(a) - rang(b))) {
    if (m.porteur !== null || m.role === 'lierne') continue;
    if (vueEnBout(m, v)) {
      const c = appliquer(t, project(m.end, v));
      etiquettes.push({ texte: m.assemblage, ancre: pt(c.x, c.y - 6), le: pt(1, 0), longueur: 0 });
      continue;
    }
    // Les brins d'une croix se coupent au milieu : on les repère au tiers.
    const e = etiquetteDeBarre(t, m, v, m.assemblage, m.role === 'contreventement' ? 0.3 : 0.5);
    if (e) etiquettes.push(e);
  }
  const refus = [...new Set(poserEtiquettes(s, etiquettes, occupe))];
  // ⚠ Un repère qui ne trouve pas de place est DIT, pas omis : le monteur doit
  // savoir que la pièce est sur la vue même s'il n'y lit pas sa marque.
  if (refus.length > 0) {
    s.texte(pt(zone.min.x + 2, zone.min.y + 3), `Repères sans place sur cette vue : ${refus.join(', ')} — voir l’ordre de montage`, { hauteur: 2, layer: 'texte' });
  }
}

function tracerTout(s: DrawScene, t: Transform2D, v: ViewDir, membres: readonly Member[]): void {
  for (const m of membres) {
    if (vueEnBout(m, v)) tracerSection(s, t, m, v, m.end);
    else tracerBarre(s, t, m, v, PRINCIPAL.includes(m.role));
  }
}

/** Plan de repérage de la toiture : ossature, pannes, poutre au vent ; poteaux en section. */
function toiture(model: StructuralModel, p: ProjectParams, opts: MontageOptions): Sheet {
  const v = VUE_PLAN;
  const toit: readonly MemberRole[] = ['traverse', 'console', 'membrure-sup', 'panne', 'lierne'];
  const membres = model.members.filter(
    (m) => toit.includes(m.role) || m.role === 'poteau' || m.role === 'potelet' || (m.role === 'contreventement' && m.id.startsWith('CVT')),
  );
  const format = meilleurFormat((f) => cadrerVue(membres, v, fenetreDe(f)).echelle);
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  const { t, echelle } = cadrerVue(membres, v, fenetre);
  tracerTout(s, t, v, membres);
  const occupe: Bbox[] = [];
  axesDuBatiment(s, t, p, v, occupe, true);
  etiquetter(s, t, v, membres, occupe, fenetre);
  dessinerCadre(s, format, { meta: opts.meta, titre: 'Plan de repérage — toiture', echelle, page: opts.page, total: opts.total });
  return { id: 'montage-plan', kind: 'montage', titre: 'Plan de repérage — toiture', format, echelle, scene: s };
}

/** Plan de repérage d'un long pan : poteaux, lisses, palées, chevêtres, vus de l'extérieur. */
function facade(
  model: StructuralModel,
  p: ProjectParams,
  titre: string,
  id: string,
  v: ViewDir,
  dansLaFacade: (m: Member) => boolean,
  axes: 'files' | 'long-pans',
  opts: MontageOptions,
): Sheet {
  const roles: readonly MemberRole[] = ['poteau', 'lisse', 'contreventement', 'chevetre', 'equerre', 'potelet', 'console'];
  const membres = model.members.filter((m) => roles.includes(m.role) && dansLaFacade(m));
  const format = meilleurFormat((f) => cadrerVue(membres, v, fenetreDe(f)).echelle);
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  const { t, echelle } = cadrerVue(membres, v, fenetre);
  tracerTout(s, t, v, membres);
  sol(s, t, v, membres);
  const occupe: Bbox[] = [];
  axesDuBatiment(s, t, p, v, occupe, axes === 'files');
  etiquetter(s, t, v, membres, occupe, fenetre);
  dessinerCadre(s, format, { meta: opts.meta, titre, echelle, page: opts.page, total: opts.total });
  return { id, kind: 'montage', titre, format, echelle, scene: s };
}

/** Les deux pignons côte à côte, chacun vu de l'extérieur. */
function pignons(
  model: StructuralModel,
  p: ProjectParams,
  ouest: (m: Member) => boolean,
  est: (m: Member) => boolean,
  opts: MontageOptions,
): Sheet {
  const roles: readonly MemberRole[] = ['poteau', 'traverse', 'console', 'potelet', 'lisse', 'contreventement', 'chevetre', 'membrure-sup', 'membrure-inf', 'montant', 'diagonale'];
  const vuesSur = (fenetre: Bbox): [string, ViewDir, (m: Member) => boolean, Bbox, number][] => {
    const milieu = (fenetre.min.x + fenetre.max.x) / 2;
    return [
      ['PIGNON OUEST — vu de l’extérieur', VUE_OUEST, ouest, { min: fenetre.min, max: pt(milieu - 3, fenetre.max.y) }, 0],
      ['PIGNON EST — vu de l’extérieur', VUE_TRANSVERSALE, est, { min: pt(milieu + 3, fenetre.min.y), max: fenetre.max }, buildingLength(p.grid)],
    ];
  };
  // Même échelle pour les deux, celle qui loge le plus grand : on compare les
  // pignons d'un coup d'œil.
  const echelleSur = (fenetre: Bbox): number =>
    Math.max(...vuesSur(fenetre).map(([, v, f, zone]) => cadrerVue(model.members.filter((m) => roles.includes(m.role) && f(m)), v, zone).echelle));
  const format = meilleurFormat((f) => echelleSur(fenetreDe(f)));
  const fenetre = fenetreDe(format);
  const milieu = (fenetre.min.x + fenetre.max.x) / 2;
  const s = new DrawScene();
  const vues = vuesSur(fenetre);
  const echelle = echelleSur(fenetre);
  for (const [titre, v, f, zone, x] of vues) {
    const membres = model.members.filter((m) => roles.includes(m.role) && f(m));
    const e = emprise(membres, v);
    const interieur: Bbox = { min: pt(zone.min.x + MARGE_VUE, zone.min.y + MARGE_VUE + 8), max: pt(zone.max.x - MARGE_VUE, zone.max.y - MARGE_VUE) };
    const t = cadrer(e, interieur, echelle);
    tracerTout(s, t, v, membres);
    for (const j of model.haunches.filter((h) => Math.abs(h.root.x - x) < 1)) tracerJarret(s, t, j, v);
    sol(s, t, v, membres);
    const occupe: Bbox[] = [];
    axesDuBatiment(s, t, p, v, occupe, false);
    etiquetter(s, t, v, membres, occupe, zone);
    s.texte(pt(zone.min.x + 2, zone.max.y - 3), titre, { hauteur: 2.6, gras: true });
  }
  s.ligne(pt(milieu, fenetre.min.y), pt(milieu, fenetre.max.y), 'cotation');
  dessinerCadre(s, format, { meta: opts.meta, titre: 'Plan de repérage — pignons', echelle, page: opts.page, total: opts.total });
  return { id: 'montage-pignons', kind: 'montage', titre: 'Plan de repérage — pignons', format, echelle, scene: s };
}

/** L'ordre de montage, phase par phase, sur sa planche. */
function ordre(model: StructuralModel, opts: MontageOptions): Sheet {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();
  dessinerTableau(s, model, fenetre);
  dessinerCadre(s, format, { meta: opts.meta, titre: 'Ordre de montage', echelle: 1, page: opts.page, total: opts.total });
  return { id: 'montage-ordre', kind: 'montage', titre: 'Ordre de montage', format, echelle: 1, scene: s };
}

/** Emprise projetée des barres, section comprise. */
function emprise(membres: readonly Member[], v: ViewDir): Bbox {
  let b: Bbox | null = null;
  for (const m of membres) {
    const sil = silhouette(m, v);
    if (sil.length === 0) continue;
    const e: Bbox = {
      min: pt(Math.min(...sil.map((q) => q.x)), Math.min(...sil.map((q) => q.y))),
      max: pt(Math.max(...sil.map((q) => q.x)), Math.max(...sil.map((q) => q.y))),
    };
    b = b ? unionBbox(b, e) : e;
  }
  return b ?? { min: pt(0, 0), max: pt(1, 1) };
}

/** Ligne de sol sous une façade. */
function sol(s: DrawScene, t: Transform2D, v: ViewDir, membres: readonly Member[]): void {
  const e = emprise(membres, v);
  const a = appliquer(t, pt(e.min.x - 600, 0));
  const b = appliquer(t, pt(e.max.x + 600, 0));
  s.ligne(a, b, 'contour');
  s.hachure([a, b, pt(b.x, b.y - 2), pt(a.x, a.y - 2)], [], 1.2, 45);
}

/**
 * Axes du bâtiment : files numérotées 1, 2, 3… le long des long-pans, lettres
 * A et B en travers. C'est ainsi que le chantier situe une pièce.
 */
function axesDuBatiment(s: DrawScene, t: Transform2D, p: ProjectParams, v: ViewDir, occupe: Bbox[], files: boolean): void {
  const g = p.grid;
  const bas = Math.min(...[0, ...frameStations(g)].map((x) => appliquer(t, project({ x, y: 0, z: 0 }, v)).y));
  const yBulle = (v === VUE_PLAN ? appliquer(t, project({ x: 0, y: -0, z: 0 }, v)).y - 14 : bas - 12);
  const marque = (c: Pt, texte: string): void => {
    bulleDAxe(s, c, texte);
    occupe.push({ min: pt(c.x - 5, c.y - 5), max: pt(c.x + 5, c.y + 5) });
  };
  if (files || v === VUE_PLAN) {
    for (const [i, x] of frameStations(g).entries()) {
      const q = appliquer(t, project({ x, y: 0, z: 0 }, v));
      marque(pt(q.x, Math.min(yBulle, q.y - 14)), `${i + 1}`);
    }
    const stations = frameStations(g);
    if (stations.length >= 2) {
      const a = appliquer(t, project({ x: stations[0] as number, y: 0, z: 0 }, v));
      const b = appliquer(t, project({ x: stations[stations.length - 1] as number, y: 0, z: 0 }, v));
      coteLineaire(s, pt(a.x, yBulle - 6), pt(b.x, yBulle - 6), 0, buildingLength(g), { hauteurTexte: 2.2, attaches: false });
    }
  }
  if (!files || v === VUE_PLAN) {
    for (const [lettre, y] of [['A', 0], ['B', g.span]] as const) {
      const q = appliquer(t, project({ x: 0, y, z: 0 }, v));
      marque(v === VUE_PLAN ? pt(q.x - 14, q.y) : pt(q.x, bas - 12), lettre);
    }
  }
}

/* ------------------------------------------------------------------ */

/**
 * Tableau de montage : ce que la grue prend, dans l'ordre.
 *
 * La masse UNITAIRE décide de l'engin ; la masse de la phase décide de la
 * journée. Les deux figurent, parce qu'on ne pose pas la même question le matin
 * au chef de manœuvre et la veille au loueur de grue.
 */
function dessinerTableau(s: DrawScene, model: StructuralModel, zone: Bbox): void {
  /*
   * ⚠ Ce que la grue lève, c'est l'ÉLÉMENT FINI — la traverse avec ses
   * platines, son jarret et ses échantignolles —, pas la barre nue : la même
   * source que le colisage et les fiches de fabrication, pour que les trois
   * annoncent la même masse.
   */
  const parRepere = new Map<string, { m: Member; n: number; unitaire: number }>(
    elementsAFabriquer(model).map((e) => [e.repere, { m: e.membre, n: e.quantite, unitaire: e.masseUnitaire }]),
  );

  // Trois colonnes : la liste coule de l'une à l'autre.
  const COLONNES = 3;
  const gouttiere = 10;
  const largeur = (zone.max.x - zone.min.x - gouttiere * (COLONNES - 1)) / COLONNES;
  let colonne = 0;
  const x0 = (): number => zone.min.x + colonne * (largeur + gouttiere);
  const bords = (): number[] => [0, largeur * 0.24, largeur * 0.62, largeur * 0.82, largeur].map((b) => x0() + b);
  let y = zone.max.y - 4;
  const place = (h: number): void => {
    if (y - h >= zone.min.y + 4 || colonne === COLONNES - 1) return;
    colonne += 1;
    y = zone.max.y - 4;
  };

  s.texte(pt(x0(), y), 'ORDRE DE MONTAGE', { hauteur: 2.8, gras: true });
  y -= 5;

  for (const phase of PHASES) {
    const lignes = [...parRepere.values()]
      .filter((x) => phase.roles.includes(x.m.role))
      .sort((a, b) => b.unitaire - a.unitaire);
    if (lignes.length === 0) continue;
    place(16);
    y -= 4;
    s.texte(pt(x0(), y), phase.titre, { hauteur: 2.3, gras: true });
    y -= 1.4;
    s.ligne(pt(x0(), y), pt(x0() + largeur, y), 'cotation');
    y -= 3.4;

    let masse = 0;
    for (const { m, n, unitaire } of lignes) {
      place(4);
      masse += unitaire * n;
      const b = bords();
      const cell = (i: number, texte: string, droite = false): void => {
        s.texte(pt(droite ? (b[i + 1] as number) - 1 : (b[i] as number), y), texte, { hauteur: 1.9, ancrage: droite ? 'droite' : 'gauche' });
      };
      cell(0, m.assemblage);
      cell(1, m.profileId);
      cell(2, `${n}`, true);
      cell(3, unitaire.toFixed(0), true);
      y -= 3.2;
    }

    y -= 0.6;
    s.texte(pt(x0(), y), `Masse de la phase`, { hauteur: 1.9, gras: true });
    s.texte(pt(x0() + largeur - 1, y), `${masse.toFixed(0)} kg`, { hauteur: 1.9, gras: true, ancrage: 'droite' });
    y -= 3.6;
  }

  place(12);
  y -= 3;
  s.texte(pt(x0(), y), 'Repère · Profil · Nb · kg/pièce', { hauteur: 1.7 });
  y -= 3.4;
  s.texte(pt(x0(), y), 'Le contreventement d’une travée se pose AVANT de libérer la grue.', { hauteur: 1.7, gras: true });
}
