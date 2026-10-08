import { getProfile } from '../../catalog/index';
import type { StructuralModel } from '../../build/types';
import { fibreAbscissa, memberFrame, sectionPointAt, type Member } from '../../geometry/member';
import { sectionOutline } from '../../geometry/section';
import { dot, sub, type Vec3 } from '../../math/vec3';
import { rad2deg } from '../../math/tolerance';
import {
  buildingLength,
  frameStations,
  leftSlopeRad,
  ridgeHeight,
  ridgeY,
  type GridParams,
} from '../../model/grid';
import type { ProjectParams } from '../../model/project';
import {
  chaineDeCotes,
  coteAngulaire,
  coteLineaire,
  coteNiveau,
  coteRepetee,
} from '../dimension';
import { dessinerCadre, fenetreDe, type CartoucheData, type SheetFormat } from '../layout';
import { renvoiDeDetail, traitDeCoupe } from '../coupeRepere';
import { choisirEchelle } from '../scale';
import { DrawScene, pt, unionBbox, type Bbox, type Layer, type Pt } from '../scene';
import { etiqueterPieces } from '../reperage';
import type { Sheet } from '../sheet';
import {
  appliquer,
  cadrer,
  empriseProjetee,
  project,
  VUE_PLAN,
  VUE_TRANSVERSALE,
  type Transform2D,
  type ViewDir,
} from '../view';

/**
 * PLANS D'ENSEMBLE : vue en plan, élévation de long pan, coupe transversale.
 *
 * Ces planches situent les pièces les unes par rapport aux autres et portent les
 * cotes de trame. Elles ne remplacent pas les plans de débit : les cotes de
 * fabrication (longueurs de coupe, angles, perçages) restent sur ceux-ci, ici on
 * cote la GÉOMÉTRIE DU BÂTIMENT.
 *
 * Les barres y sont tracées entre points de travail, en double trait à leur
 * épaisseur réelle. C'est la convention des plans d'ensemble : le détail exact
 * des abouts appartient aux plans de détail.
 */

export interface EnsembleOptions {
  readonly format?: SheetFormat;
  readonly page: number;
  readonly total: number;
  readonly meta: CartoucheData['meta'];
}

/* ------------------------------------------------------------------ */
/* Silhouette projetée d'une barre                                     */
/* ------------------------------------------------------------------ */

/**
 * Contour d'une barre vue en projection : un quadrilatère dont la largeur est
 * l'encombrement RÉEL de la section mesuré perpendiculairement à l'axe projeté.
 * Une panne vue de dessus fait donc sa largeur de semelle, et vue en coupe sa
 * hauteur d'âme — sans que l'appelant ait à s'en soucier.
 *
 * ⚠⚠ Ses abouts sont les PLANS DE COUPE, pas les points d'épure. Le contour
 * allait d'un point de travail à l'autre : chaque barre était dessinée à sa
 * longueur d'épure, jamais à sa longueur de débit — le poteau s'arrêtait à
 * mi-hauteur de traverse, la console entrait jusqu'à l'axe du poteau, et une
 * coupe biaise se dessinait d'équerre. Un plan d'atelier qui ne montre pas la
 * pièce telle qu'on la scie n'est pas un plan d'atelier.
 */
export function silhouette(m: Member, v: ViewDir): Pt[] {
  const profil = getProfile(m.profileId);
  const f = memberFrame(m);
  const a = project(m.start, v);
  const b = project(m.end, v);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-9) return [];
  const ux = (b.x - a.x) / l;
  const uy = (b.y - a.y) / l;
  const nx = -uy;
  const ny = ux;

  // Les deux fibres extrêmes de la section, vues dans la direction transversale.
  let bas = { e: Infinity, cy: 0, cz: 0 };
  let haut = { e: -Infinity, cy: 0, cz: 0 };
  for (const cy of [-profil.b / 2, profil.b / 2]) {
    for (const cz of [-profil.h / 2, profil.h / 2]) {
      const offset: Vec3 = {
        x: f.ay.x * cy + f.az.x * cz,
        y: f.ay.y * cy + f.az.y * cz,
        z: f.ay.z * cy + f.az.z * cz,
      };
      const e = dot(offset, v.right) * nx + dot(offset, v.up) * ny;
      if (e < bas.e) bas = { e, cy, cz };
      if (e > haut.e) haut = { e, cy, cz };
    }
  }
  /*
   * Chaque fibre s'arrête là où elle perce le plan de coupe : c'est ce qui
   * dessine une coupe biaise biaise, et une pièce éboutée plus courte que son
   * épure. On reporte l'abscisse ainsi trouvée sur l'axe projeté.
   */
  const coin = (fibre: { e: number; cy: number; cz: number }, plan: Member['cutStart']): Pt => {
    const sAbs = fibreAbscissa(f, m.start, plan, { y: fibre.cy, z: fibre.cz });
    const p3 = sectionPointAt(f, m.start, sAbs, { y: 0, z: 0 });
    const q = project(p3, v);
    return pt(q.x + nx * fibre.e, q.y + ny * fibre.e);
  };
  return [coin(bas, m.cutStart), coin(bas, m.cutEnd), coin(haut, m.cutEnd), coin(haut, m.cutStart)];
}

export function tracer(s: DrawScene, t: Transform2D, points: readonly Pt[], layer: Layer = 'contour'): void {
  s.polyligne(points.map((q) => appliquer(t, q)), true, layer);
}

/** Emprise projetée de barres entières, section comprise. */
export function emprise(membres: readonly Member[], v: ViewDir): Bbox {
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
  return b ?? empriseProjetee([], v);
}

/** Prépare une feuille : cadre, échelle, cadrage. */
export function preparer(
  membres: readonly Member[],
  v: ViewDir,
  titre: string,
  opts: EnsembleOptions,
  margeModele: number,
): { s: DrawScene; t: Transform2D; echelle: number; fenetre: Bbox; format: SheetFormat } {
  const format = opts.format ?? 'A3';
  const e = emprise(membres, v);
  const avecMarge: Bbox = {
    min: pt(e.min.x - margeModele, e.min.y - margeModele),
    max: pt(e.max.x + margeModele, e.max.y + margeModele),
  };
  const fenetre = fenetreDe(format);
  const echelle = choisirEchelle(avecMarge, fenetre, 1.05);
  const t = cadrer(avecMarge, fenetre, echelle);

  const s = new DrawScene();
  dessinerCadre(s, format, {
    meta: opts.meta,
    titre,
    echelle,
    page: opts.page,
    total: opts.total,
  });
  return { s, t, echelle, fenetre, format };
}

/* ------------------------------------------------------------------ */
/* Coupe transversale                                                  */
/* ------------------------------------------------------------------ */

/**
 * Coupe transversale sur une file : le portique ou la ferme en vraie forme, les
 * pannes et lisses coupées apparaissant en section hachurée.
 */
/** Renvoi vers une planche de détail, tracé sur la coupe qui porte le nœud. */
export interface RenvoiDetail {
  readonly lettre: string;
  readonly point: Vec3;
  /** Rayon de la zone détaillée, en mm de modèle. */
  readonly rayon: number;
}

export function sheetCoupe(
  model: StructuralModel,
  p: ProjectParams,
  station: number,
  lettre: string,
  opts: EnsembleOptions,
  renvois: readonly RenvoiDetail[] = [],
): Sheet {
  const g = p.grid;
  const x0 = frameStations(g)[station] ?? 0;
  const v = VUE_TRANSVERSALE;
  const pignon = station === 0 || station === g.nBays;
  /*
   * ⚠ Le titre porte la LETTRE, pas seulement le numéro de file. C'est elle qui
   * fait le lien avec le trait de coupe tracé sur la vue en plan : « Coupe A-A »
   * se retrouve sans compter les files, ce qui est précisément le comptage dont
   * on se trompe.
   */
  const titre = `Coupe ${lettre}-${lettre} — file ${station + 1}${pignon ? ' (pignon)' : ''}`;

  // Barres du plan de coupe : celles dont les deux abouts y sont.
  const dansLePlan = model.members.filter(
    (m) => Math.abs(m.start.x - x0) < 1 && Math.abs(m.end.x - x0) < 1,
  );
  // Barres traversant le plan : elles se voient en section.
  const traversantes = model.members.filter(
    (m) => (m.start.x - x0) * (m.end.x - x0) < -1 || (Math.abs(m.start.x - x0) < 1) !== (Math.abs(m.end.x - x0) < 1),
  );

  const { s, t, echelle, fenetre } = preparer(dansLePlan, v, titre, opts, 600);

  for (const m of dansLePlan) tracer(s, t, silhouette(m, v));
  for (const m of traversantes) sectionCoupee(s, t, m, v);
  for (const h of model.haunches.filter((j) => Math.abs(j.root.x - x0) < 1)) {
    const a = project(h.root, v);
    const b = project(h.tip, v);
    const prof = getProfile(h.profileId);
    const dz = -(prof.h / 2 + h.rootDepth);
    tracer(s, t, [a, b, pt(b.x, b.y - prof.h / 2), pt(a.x, a.y + dz)], 'contour');
  }

  coterCoupe(s, t, g, p, fenetre, echelle);

  /*
   * ⚠ Repérage AVEC LE PROFIL, et pas seulement une bulle portant le repère.
   * Une bulle « TR1 » oblige à ouvrir la nomenclature pour savoir quel acier
   * commander ou vérifier ; « TR1 · IPE 360 » se lit sur place. Les pièces
   * TRAVERSANTES sont nommées elles aussi : sur une coupe transversale, les
   * pannes et les lisses vues en section sont la moitié de ce qu'on cherche à
   * situer, et elles n'avaient aucune étiquette.
   */
  /*
   * Renvois de détail AVANT le repérage : les étiquettes des pièces doivent
   * contourner les bulles, et non l'inverse — une bulle déplacée ne désignerait
   * plus son nœud.
   */
  const centreVue = appliquer(t, project({ x: x0, y: g.span / 2, z: g.eaveHeight / 2 }, v));
  const occupe = renvois.map((r) => {
    const c = appliquer(t, project(r.point, v));
    return renvoiDeDetail(s, c, r.rayon * t.facteur, r.lettre, {
      x: c.x - centreVue.x,
      y: c.y - centreVue.y,
    });
  });

  etiqueterPieces(s, t, v, [...dansLePlan, ...traversantes], { occupe });
  return { id: `coupe-${lettre}`, kind: 'coupe', titre, format: opts.format ?? 'A3', echelle, scene: s };
}

/** Section hachurée d'une barre traversant le plan de coupe. */
export function sectionCoupee(s: DrawScene, t: Transform2D, m: Member, v: ViewDir): void {
  const profil = getProfile(m.profileId);
  const f = memberFrame(m);
  const contour = sectionOutline(profil, 6);
  const centre = project(m.start, v);

  const en2d = (q: { y: number; z: number }): Pt => {
    const offset: Vec3 = {
      x: f.ay.x * q.y + f.az.x * q.z,
      y: f.ay.y * q.y + f.az.y * q.z,
      z: f.ay.z * q.y + f.az.z * q.z,
    };
    return appliquer(t, pt(centre.x + dot(offset, v.right), centre.y + dot(offset, v.up)));
  };
  const ext = contour.outer.map(en2d);
  const trous = contour.holes.map((r) => r.map(en2d));
  s.hachure(ext, trous, 1.2, 45);
  s.polyligne(ext, true, 'contour-fin');
  for (const r of trous) s.polyligne(r, true, 'contour-fin');
}

/** Cotation d'une coupe : portée, hauteurs, pente, niveaux. */
function coterCoupe(
  s: DrawScene,
  t: Transform2D,
  g: GridParams,
  p: ProjectParams,
  fenetre: Bbox,
  echelle: number,
): void {
  const yr = ridgeY(g);
  const zr = ridgeHeight(g);

  const solGauche = appliquer(t, pt(0, 0));
  const solDroit = appliquer(t, pt(g.span, 0));
  const bas = fenetre.min.y + 14;

  // Axes du portique : les deux files de poteaux et le faîtage. Une coupe sans
  // axes ne permet pas de rattacher les cotes à la trame.
  for (const y of g.roofType === 'bipente' ? [0, yr, g.span] : [0, g.span]) {
    const haut = y === 0 || y === g.span ? g.eaveHeight : zr;
    s.ligne(appliquer(t, pt(y, -700)), appliquer(t, pt(y, haut + 700)), 'axe');
  }

  // Portée d'axe à axe, sous le bâtiment.
  coteLineaire(s, pt(solGauche.x, bas), pt(solDroit.x, bas), 0, g.span, { hauteurTexte: 3 });
  if (g.roofType === 'bipente') {
    const faitageSol = appliquer(t, pt(yr, 0));
    chaineDeCotes(
      s,
      [pt(solGauche.x, bas + 10), pt(faitageSol.x, bas + 10), pt(solDroit.x, bas + 10)],
      0,
      [yr, g.span - yr],
      { total: false },
    );
  }

  // Hauteurs à droite du bâtiment.
  const xCote = appliquer(t, pt(g.span, 0)).x + 18;
  coteLineaire(s, pt(xCote, solGauche.y), pt(xCote, appliquer(t, pt(g.span, g.eaveHeight)).y), 0, g.eaveHeight);
  coteLineaire(s, pt(xCote + 12, solGauche.y), pt(xCote + 12, appliquer(t, pt(yr, zr)).y), 0, zr);

  // Niveaux : sol, égout, faîtage.
  coteNiveau(s, appliquer(t, pt(0, 0)), 0);
  coteNiveau(s, appliquer(t, pt(0, g.eaveHeight)), g.eaveHeight);
  coteNiveau(s, appliquer(t, pt(yr, zr)), zr);

  // Pente du versant, à mi-rampant.
  const a = leftSlopeRad(g);
  const milieu = appliquer(t, pt(yr / 2, g.eaveHeight + (yr / 2) * Math.tan(a)));
  coteAngulaire(s, milieu, 0, a, Math.max(12, 900 / echelle), rad2deg(a));
  s.texte(pt(milieu.x, milieu.y + 8), `pente ${g.slope} %`, { hauteur: 2.5, ancrage: 'centre' });

  // Rappel des profils employés.
  const lignes = p.frame.enabled
    ? [`Poteaux ${p.frame.columnProfile}`, `Traverses ${p.frame.rafterProfile}`]
    : [
        `Poteaux ${p.frame.columnProfile}`,
        `Membrures ${p.truss.topChordProfile} / ${p.truss.bottomChordProfile}`,
        `Treillis ${p.truss.diagonalProfile}`,
      ];
  let y = fenetre.max.y - 5;
  for (const l of lignes) {
    s.texte(pt(fenetre.min.x, y), l, { hauteur: 2.5 });
    y -= 4;
  }
}

/* ------------------------------------------------------------------ */
/* Vue en plan                                                         */
/* ------------------------------------------------------------------ */

/** Une coupe du dossier, telle qu'elle doit se repérer sur la vue en plan. */
export interface CoupeRepere {
  readonly lettre: string;
  /** Abscisse longitudinale du plan de coupe (mm). */
  readonly x: number;
}

export function sheetPlan(
  model: StructuralModel,
  p: ProjectParams,
  coupes: readonly CoupeRepere[],
  opts: EnsembleOptions,
): Sheet {
  const g = p.grid;
  const v = VUE_PLAN;
  const aTracer = model.members.filter(
    (m) => m.role !== 'lisse' && m.role !== 'lierne' && m.role !== 'contreventement',
  );
  const { s, t, echelle, fenetre } = preparer(aTracer, v, 'Vue en plan', opts, 900);

  // Pannes et traverses au trait fin, poteaux en section : c'est le poteau qui
  // situe la trame, il doit ressortir.
  for (const m of aTracer) {
    if (m.role === 'poteau') continue;
    tracer(s, t, silhouette(m, v), 'contour-fin');
  }
  for (const m of model.members.filter((x) => x.role === 'poteau')) {
    sectionCoupee(s, t, m, v);
  }

  // Trame : axes de files et de long pans.
  const stations = frameStations(g);
  const L = buildingLength(g);
  for (const [i, x] of stations.entries()) {
    const a = appliquer(t, pt(x, -800));
    const b = appliquer(t, pt(x, g.span + 800));
    s.ligne(a, b, 'axe');
    s.cercle(pt(a.x, a.y - 6), 4, 'reperage');
    s.texte(pt(a.x, a.y - 6), `${i + 1}`, {
      hauteur: 2.5,
      ancrage: 'centre',
      ligneDeBase: 'milieu',
      gras: true,
      layer: 'reperage',
    });
  }
  for (const y of [0, g.span]) {
    s.ligne(appliquer(t, pt(-800, y)), appliquer(t, pt(L + 800, y)), 'axe');
  }

  // Cotation : entraxes de portiques et portée.
  const yCote = appliquer(t, pt(0, g.span)).y + 16;
  coteRepetee(
    s,
    pt(appliquer(t, pt(0, 0)).x, yCote),
    pt(appliquer(t, pt(L, 0)).x, yCote),
    0,
    g.nBays,
    g.baySpacing,
  );
  const xCote = appliquer(t, pt(L, 0)).x + 16;
  coteLineaire(
    s,
    pt(xCote, appliquer(t, pt(0, 0)).y),
    pt(xCote, appliquer(t, pt(0, g.span)).y),
    0,
    g.span,
  );
  /*
   * ⚠ TRAITS DE COUPE. Sans eux, une planche intitulée « Coupe — file 3 » oblige
   * à compter les files sur ce dessin pour savoir ce qu'on regarde. Le trait et
   * le titre portent la même lettre : le lien se lit sans réfléchir.
   *
   * Le sens du regard est celui du repère transversal employé par les coupes —
   * on regarde vers les x DÉCROISSANTS — et il doit rester cohérent avec lui,
   * sans quoi un bâtiment dissymétrique serait dessiné en miroir.
   */
  for (const c of coupes) {
    const a = appliquer(t, pt(c.x, -1600));
    const b = appliquer(t, pt(c.x, g.span + 1600));
    traitDeCoupe(s, a, b, c.lettre, { x: -1, y: 0 });
  }

  s.texte(pt(fenetre.min.x, fenetre.max.y - 5), `Emprise ${(L / 1000).toFixed(2)} × ${(g.span / 1000).toFixed(2)} m`, {
    hauteur: 2.5,
  });

  return { id: 'plan', kind: 'ensemble', titre: 'Vue en plan', format: opts.format ?? 'A3', echelle, scene: s };
}

/** Exposé pour les contrôles. */
export { project, sub };
