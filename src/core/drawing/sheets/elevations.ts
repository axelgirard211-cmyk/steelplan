import type { StructuralModel } from '../../build/types';
import type { Member } from '../../geometry/member';
import { v3 } from '../../math/vec3';
import { buildingLength, frameStations } from '../../model/grid';
import type { FaceOuverture } from '../../model/ouvertures';
import type { ProjectParams } from '../../model/project';
import { dessinerCadre, fenetreDe } from '../layout';
import { dessinerOuvertures } from '../ouvertures';
import { bulleDeFile, etiqueterPieces } from '../reperage';
import { ECHELLES } from '../scale';
import { DrawScene, pt, unionBbox, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import {
  appliquer,
  cadrer,
  project,
  VUE_LONG_PAN,
  VUE_TRANSVERSALE,
  type Transform2D,
  type ViewDir,
} from '../view';
import { emprise, silhouette, tracer, type EnsembleOptions } from './ensemble';

/**
 * PLANCHE D'ÉLÉVATIONS — toutes les faces du bâtiment sur UNE feuille.
 *
 * ⚠ C'est le document qu'on étale sur le capot pour comprendre l'ouvrage. Une
 * élévation par planche oblige à feuilleter pour comparer deux faces, et l'on
 * perd précisément ce qu'on cherchait : où passe le contreventement d'un long
 * pan par rapport à celui du pignon, à quelle hauteur les lisses se
 * correspondent. Les mettre côte à côte est tout l'intérêt.
 *
 * ⚠⚠ TOUTES LES VUES À LA MÊME ÉCHELLE, et c'est la règle qui rend la planche
 * lisible. Cadrer chaque vue au mieux de sa case donnerait un pignon dessiné
 * deux fois plus grand qu'un long pan : deux hauteurs d'égout identiques n'y
 * auraient pas la même longueur sur le papier, et toute comparaison à la règle
 * — celle que fait l'œil sans y penser — deviendrait fausse.
 *
 * Les vues sont nommées PAR FILE, comme sur un plan de bureau d'études : les
 * files transversales portent des chiffres, les longitudinales des lettres.
 * « Élévation file 1 » se retrouve sans compter les travées, contrairement à
 * « façade pignon ouest » qui suppose qu'on sache où est l'ouest.
 */

interface Vue {
  readonly titre: string;
  readonly v: ViewDir;
  /** Façade correspondante : c'est par elle qu'on retrouve ses ouvertures. */
  readonly face: FaceOuverture;
  readonly membres: readonly Member[];
  /** Positions des bulles de file, en coordonnées du modèle projetées. */
  readonly files: readonly { readonly x: number; readonly libelle: string }[];
}

/** Long pan ARRIÈRE vu de l'extérieur : on regarde vers les y décroissants. */
const VUE_LONG_PAN_ARRIERE: ViewDir = {
  origin: v3(0, 0, 0),
  right: v3(-1, 0, 0),
  up: v3(0, 0, 1),
};

/** Pignon OUEST vu de l'extérieur : on regarde vers les x croissants. */
const VUE_PIGNON_OUEST: ViewDir = {
  origin: v3(0, 0, 0),
  right: v3(0, -1, 0),
  up: v3(0, 0, 1),
};

export function sheetElevations(
  model: StructuralModel,
  p: ProjectParams,
  opts: EnsembleOptions,
): Sheet {
  const format = opts.format ?? 'A1';
  const vues = vuesDe(model, p);

  const s = new DrawScene();
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre: 'Plan d’élévation',
    echelle: 0, // remplacé plus bas : l'échelle n'est connue qu'après cadrage
    page: opts.page,
    total: opts.total,
  });

  const { echelle, cases } = mettreEnPage(fenetreDe(format), vues);

  for (const [i, vue] of vues.entries()) {
    const cellule = cases[i] as Bbox;
    const t = cadrer(empriseAvecMarge(vue), cellule, echelle);
    tracerVue(s, t, vue, cellule, echelle, p);
  }

  return {
    id: 'elevations',
    kind: 'elevation',
    titre: 'Plan d’élévation',
    format,
    echelle,
    scene: s,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Marge autour d'une vue, EN MILLIMÈTRES DE MODÈLE.
 *
 * Elle laisse la place au titre sous la vue et aux bulles de file. Exprimée sur
 * le modèle et non sur le papier, elle suit l'échelle : sur un petit bâtiment
 * dessiné plus grand, la marge de papier reste la même.
 */
function empriseAvecMarge(vue: Vue): Bbox {
  const e = emprise(vue.membres, vue.v);
  return {
    min: pt(e.min.x - 1200, e.min.y - 2600),
    max: pt(e.max.x + 1200, e.max.y + 900),
  };
}

/**
 * Échelle commune et cases, dimensionnées sur le CONTENU.
 *
 * ⚠ Le premier découpage attribuait à chaque rangée une FRACTION FIXE de la
 * hauteur : 42 % aux pignons, le reste aux long pans. Comme toutes les vues
 * partagent l'échelle imposée par la plus grande, les pignons — plus courts —
 * n'occupaient qu'une part de leur case, et la planche montrait une bande vide
 * de plusieurs centimètres entre les deux rangées. La hauteur d'une rangée doit
 * suivre ce qu'on y dessine, pas une proportion décidée d'avance.
 *
 * ⚠⚠ La difficulté est que la taille sur le papier DÉPEND de l'échelle, qui
 * dépend elle-même de la place disponible. On ne la résout pas par un calcul
 * direct : on essaie les échelles normalisées de la plus fine à la plus
 * grossière et l'on garde la première qui rentre. C'est le même piège que celui
 * des marges de cotation exprimées en millimètres papier, et la même issue.
 */
function mettreEnPage(f: Bbox, vues: readonly Vue[]): { echelle: number; cases: Bbox[] } {
  const L = f.max.x - f.min.x;
  const H = f.max.y - f.min.y;
  const emprises = vues.map(empriseAvecMarge);

  /*
   * Rangées : les deux pignons CÔTE À CÔTE en haut, un long pan par rangée en
   * dessous. Un long pan de 30 m tient mal dans une demi-largeur, un pignon de
   * 20 m y tient bien — c'est la disposition qu'adoptent les planches du métier,
   * et pour cette raison-là.
   */
  const rangees: number[][] = vues.length >= 4 ? [[0, 1], [2], [3]] : vues.map((_, i) => [i]);

  const largeurDe = (i: number, e: number): number =>
    (emprises[i] as Bbox).max.x - (emprises[i] as Bbox).min.x === 0
      ? 0
      : ((emprises[i] as Bbox).max.x - (emprises[i] as Bbox).min.x) / e;
  const hauteurDe = (i: number, e: number): number =>
    ((emprises[i] as Bbox).max.y - (emprises[i] as Bbox).min.y) / e;

  let echelle = ECHELLES[ECHELLES.length - 1] as number;
  for (const d of ECHELLES) {
    const largeurs = rangees.map((r) => r.reduce((s, i) => s + largeurDe(i, d), 0));
    const hauteurs = rangees.map((r) => Math.max(...r.map((i) => hauteurDe(i, d))));
    if (
      largeurs.every((x) => x <= L) &&
      hauteurs.reduce((s, x) => s + x, 0) + ESPACE_ENTRE_RANGEES * (rangees.length - 1) <= H
    ) {
      echelle = d;
      break;
    }
  }

  const hauteurs = rangees.map((r) => Math.max(...r.map((i) => hauteurDe(i, echelle))));
  const total = hauteurs.reduce((s, x) => s + x, 0);

  /*
   * ⚠ ÉCART CONSTANT entre les rangées, et le bloc CENTRÉ dans la feuille.
   *
   * Deux essais ratés avant celui-ci : diviser le vide par le nombre de rangées
   * laissait une bande morte sous la dernière vue ; le diviser par les seuls
   * intervalles écartait les vues de plusieurs centimètres, si bien qu'elles ne
   * se lisaient plus comme un même document. Un écart fixe, juste ce qu'il faut
   * pour le titre et les bulles, garde les vues groupées — et le vide restant,
   * réparti en haut et en bas, ne gêne personne.
   */
  const respiration = ESPACE_ENTRE_RANGEES;
  const hauteurBloc = total + respiration * (rangees.length - 1);

  const cases: Bbox[] = new Array(vues.length);
  let y = f.max.y - Math.max(0, (H - hauteurBloc) / 2);
  for (const [r, indices] of rangees.entries()) {
    const h = hauteurs[r] as number;
    const largeurRangee = L / indices.length;
    for (const [k, i] of indices.entries()) {
      cases[i] = {
        min: pt(f.min.x + largeurRangee * k, y - h),
        max: pt(f.min.x + largeurRangee * (k + 1), y),
      };
    }
    y -= h + respiration;
  }
  return { echelle, cases };
}

/** Respiration minimale entre deux rangées (mm papier), titre compris. */
const ESPACE_ENTRE_RANGEES = 24;

function tracerVue(
  s: DrawScene,
  t: Transform2D,
  vue: Vue,
  cellule: Bbox,
  echelle: number,
  p: ProjectParams,
): void {
  for (const m of vue.membres) {
    const fort = m.role === 'poteau' || m.role === 'potelet';
    tracer(s, t, silhouette(m, vue.v), fort ? 'contour' : 'contour-fin');
  }

  // Les ouvertures par-dessus l'ossature : leur rectangle doit rester lisible.
  dessinerOuvertures(s, t, vue.v, p, vue.face);

  // Bas de la vue, mesuré sur le dessin : les bulles s'y accrochent.
  const bas = Math.min(
    ...vue.membres.flatMap((m) => [
      appliquer(t, project(m.start, vue.v)).y,
      appliquer(t, project(m.end, vue.v)).y,
    ]),
  );
  const yBulle = bas - 9;

  for (const f of vue.files) {
    const q = appliquer(t, project(pointDeFile(vue.v, f.x), vue.v));
    s.ligne(pt(q.x, yBulle + 4), pt(q.x, bas), 'axe');
    bulleDeFile(s, pt(q.x, yBulle), f.libelle, 3.2);
  }

  /*
   * Titre SOUS la vue, échelle comprise : c'est là qu'on le cherche quand on
   * lit une planche qui en porte plusieurs.
   */
  const cx = (cellule.min.x + cellule.max.x) / 2;
  s.texte(pt(cx, yBulle - 10), `${vue.titre} — éch. 1/${echelle}`, {
    hauteur: 3.2,
    gras: true,
    ancrage: 'centre',
    layer: 'texte',
  });

  etiqueterPieces(s, t, vue.v, vue.membres, {
    hauteur: 1.8,
    occupe: [
      { x0: cellule.min.x - 20, y0: yBulle - 14, x1: cellule.max.x + 20, y1: yBulle + 5 },
    ],
  });
}

/** Point du modèle correspondant à l'abscisse d'une file, selon la vue. */
function pointDeFile(v: ViewDir, x: number): Pt & { z: number } {
  // Une file transversale se repère par x, une longitudinale par y.
  return v === VUE_TRANSVERSALE || v === VUE_PIGNON_OUEST
    ? { x: 0, y: x, z: 0 }
    : { x, y: 0, z: 0 };
}

/**
 * Les vues de la planche et ce qu'elles montrent.
 *
 * ⚠ Chaque vue ne garde que la MOITIÉ du bâtiment située de son côté. Tout
 * garder superposerait les deux faces opposées ; ne garder que le plan de la
 * façade ferait disparaître la toiture, qui fait pourtant partie de ce qu'on
 * voit depuis l'extérieur.
 */
function vuesDe(model: StructuralModel, p: ProjectParams): Vue[] {
  const g = p.grid;
  const L = buildingLength(g);
  const stations = frameStations(g);
  const derniere = stations.length;

  const filesTransversales = [
    { x: 0, libelle: 'A' },
    { x: g.span, libelle: 'B' },
  ];
  const filesLongitudinales = stations.map((x, i) => ({ x, libelle: `${i + 1}` }));

  return [
    {
      titre: `Élévation file 1`,
      v: VUE_PIGNON_OUEST,
      face: 'pignon-ouest',
      membres: model.members.filter((m) => m.start.x < L / 2 && m.end.x < L / 2),
      files: filesTransversales,
    },
    {
      titre: `Élévation file ${derniere}`,
      v: VUE_TRANSVERSALE,
      face: 'pignon-est',
      membres: model.members.filter((m) => m.start.x > L / 2 && m.end.x > L / 2),
      files: filesTransversales,
    },
    {
      titre: 'Élévation file A',
      v: VUE_LONG_PAN,
      face: 'long-pan-gauche',
      membres: model.members.filter((m) => m.start.y < g.span / 2 && m.end.y < g.span / 2),
      files: filesLongitudinales,
    },
    {
      titre: 'Élévation file B',
      v: VUE_LONG_PAN_ARRIERE,
      face: 'long-pan-droit',
      membres: model.members.filter((m) => m.start.y > g.span / 2 && m.end.y > g.span / 2),
      files: filesLongitudinales,
    },
  ];
}

/** Emprise totale des vues, exposée pour les contrôles de mise en page. */
export function empriseDesVues(model: StructuralModel, p: ProjectParams): Bbox {
  const vues = vuesDe(model, p);
  return vues
    .map((vue) => emprise(vue.membres, vue.v))
    .reduce((a, b) => unionBbox(a, b));
}
