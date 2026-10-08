import type { StructuralModel } from '../../build/types';
import type { Member, MemberRole } from '../../geometry/member';
import { buildingLength, frameStations, ridgeHeight } from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import { coteLineaire } from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData } from '../layout';
import { choisirEchelle } from '../scale';
import { DrawScene, pt, unionBbox, type Bbox, type Pt } from '../scene';
import type { Sheet } from '../sheet';
import { elementsAFabriquer } from './element';
import {
  appliquer,
  cadrer,
  project,
  VUE_LONG_PAN,
  VUE_PLAN,
  type Transform2D,
  type ViewDir,
} from '../view';
import { silhouette } from './ensemble';

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

/** Rôles dont chaque exemplaire est repéré individuellement sur le plan. */
const REPERES_INDIVIDUELS: readonly MemberRole[] = [
  'poteau',
  'traverse',
  'console',
  'potelet',
  'membrure-sup',
  'membrure-inf',
];

export function sheetsMontage(
  model: StructuralModel,
  p: ProjectParams,
  opts: MontageOptions,
): Sheet[] {
  return [
    planche(model, p, VUE_PLAN, 'Plan de repérage — vue en plan', 'montage-plan', {
      ...opts,
    }),
    planche(
      model,
      p,
      VUE_LONG_PAN,
      'Plan de repérage — élévation et ordre de montage',
      'montage-elevation',
      { ...opts, page: opts.page + 1 },
      true,
    ),
  ];
}

/* ------------------------------------------------------------------ */

function planche(
  model: StructuralModel,
  p: ProjectParams,
  v: ViewDir,
  titre: string,
  id: string,
  opts: MontageOptions,
  avecTableau = false,
): Sheet {
  const format = 'A3' as const;
  const fenetre = fenetreDe(format);
  const s = new DrawScene();

  // Le tableau de montage occupe la colonne de droite ; le dessin le reste.
  const largeurTableau = avecTableau ? 132 : 0;
  const zone: Bbox = {
    min: fenetre.min,
    max: pt(fenetre.max.x - largeurTableau - (avecTableau ? 6 : 0), fenetre.max.y),
  };

  const marge = Math.max(1500, p.grid.baySpacing * 0.2);
  const e = emprise(model.members, v);
  const avecMarge: Bbox = {
    min: pt(e.min.x - marge, e.min.y - marge),
    max: pt(e.max.x + marge, e.max.y + marge),
  };
  const echelle = choisirEchelle(avecMarge, zone, 1.05);
  const t = cadrer(avecMarge, zone, echelle);

  for (const m of model.members) {
    const sil = silhouette(m, v);
    if (sil.length >= 2) {
      s.polyligne(
        sil.map((q) => appliquer(t, q)),
        true,
        secondaire(m.role) ? 'contour-fin' : 'contour',
      );
    }
  }

  repererChaquePiece(s, t, model.members, v);
  coterFiles(s, t, p, v);

  if (avecTableau) {
    dessinerTableau(s, model, {
      min: pt(fenetre.max.x - largeurTableau, fenetre.min.y),
      max: fenetre.max,
    });
  }

  dessinerCadre(s, format, {
    meta: opts.meta,
    titre,
    echelle,
    page: opts.page,
    total: opts.total,
  });

  return { id, kind: 'montage', titre, format, echelle, scene: s };
}

const secondaire = (r: MemberRole): boolean =>
  r === 'panne' || r === 'lisse' || r === 'lierne' || r === 'attache';

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

/**
 * Le repère de CHAQUE pièce, à sa place.
 *
 * ⚠ C'est ce qui distingue ce plan des plans d'ensemble, qui n'en repèrent qu'un
 * exemplaire par famille. Seuls les rôles PRIMAIRES sont repérés un par un : une
 * halle de trente mètres compte quatre cents pannes, et les étiqueter toutes
 * noierait les vingt repères que le monteur cherche vraiment.
 *
 * Les repères déjà écrits au même endroit ne sont pas réécrits : deux pièces
 * superposées en projection — les deux brins d'une croix, une panne derrière une
 * autre — produiraient un empilement illisible.
 */
function repererChaquePiece(
  s: DrawScene,
  t: Transform2D,
  membres: readonly Member[],
  v: ViewDir,
): void {
  const occupes: Pt[] = [];
  const libre = (q: Pt): boolean =>
    !occupes.some((o) => Math.abs(o.x - q.x) < 7 && Math.abs(o.y - q.y) < 3.2);

  for (const m of membres) {
    if (!REPERES_INDIVIDUELS.includes(m.role) || m.porteur !== null) continue;
    const a = project(m.start, v);
    const b = project(m.end, v);
    const milieu = appliquer(t, pt((a.x + b.x) / 2, (a.y + b.y) / 2));
    if (!libre(milieu)) continue;
    occupes.push(milieu);
    s.texte(milieu, m.assemblage, {
      hauteur: 2.4,
      gras: true,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
      layer: 'reperage',
    });
  }
}

/** Files repérées 1, 2, 3… : c'est ainsi que le chantier situe une pièce. */
function coterFiles(s: DrawScene, t: Transform2D, p: ProjectParams, v: ViewDir): void {
  const files = frameStations(p.grid);
  const yBase = v === VUE_PLAN ? -p.grid.span * 0.08 : -ridgeHeight(p.grid) * 0.12;

  for (const [i, x] of files.entries()) {
    const q = appliquer(t, project({ x, y: yBase, z: yBase }, v));
    s.cercle(q, 4, 'reperage');
    s.texte(q, `${i + 1}`, {
      hauteur: 2.6,
      gras: true,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
      layer: 'reperage',
    });
  }

  if (files.length >= 2) {
    const a = appliquer(t, project({ x: files[0] as number, y: yBase, z: yBase }, v));
    const b = appliquer(
      t,
      project({ x: files[files.length - 1] as number, y: yBase, z: yBase }, v),
    );
    coteLineaire(s, a, b, -10, buildingLength(p.grid), { hauteurTexte: 2.2, attaches: false });
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

  const largeur = zone.max.x - zone.min.x;
  const colonnes = [0, largeur * 0.24, largeur * 0.62, largeur * 0.82, largeur];
  let y = zone.max.y - 4;

  s.texte(pt(zone.min.x, y), 'ORDRE DE MONTAGE', { hauteur: 2.8, gras: true });
  y -= 5;

  for (const phase of PHASES) {
    const lignes = [...parRepere.values()]
      .filter((x) => phase.roles.includes(x.m.role))
      .sort((a, b) => b.unitaire - a.unitaire);
    if (lignes.length === 0) continue;
    if (y < zone.min.y + 14) break;

    y -= 4;
    s.texte(pt(zone.min.x, y), phase.titre, { hauteur: 2.3, gras: true });
    y -= 1.4;
    s.ligne(pt(zone.min.x, y), pt(zone.max.x, y), 'cotation');
    y -= 3.4;

    let masse = 0;
    for (const { m, n, unitaire } of lignes) {
      if (y < zone.min.y + 8) break;
      masse += unitaire * n;
      const cell = (i: number, texte: string, droite = false): void => {
        s.texte(
          pt(zone.min.x + (droite ? (colonnes[i + 1] as number) - 1 : (colonnes[i] as number)), y),
          texte,
          { hauteur: 1.9, ancrage: droite ? 'droite' : 'gauche' },
        );
      };
      cell(0, m.assemblage);
      cell(1, m.profileId);
      cell(2, `${n}`, true);
      cell(3, unitaire.toFixed(0), true);
      y -= 3.2;
    }

    y -= 0.6;
    s.texte(pt(zone.min.x, y), `Masse de la phase`, { hauteur: 1.9, gras: true });
    s.texte(pt(zone.max.x - 1, y), `${masse.toFixed(0)} kg`, {
      hauteur: 1.9,
      gras: true,
      ancrage: 'droite',
    });
    y -= 3.6;
  }

  if (y > zone.min.y + 8) {
    y -= 3;
    s.texte(pt(zone.min.x, y), 'Repère · Profil · Nb · kg/pièce', { hauteur: 1.7 });
    y -= 3.4;
    s.texte(
      pt(zone.min.x, y),
      'Le contreventement d’une travée se pose AVANT de libérer la grue.',
      { hauteur: 1.7, gras: true },
    );
  }
}
